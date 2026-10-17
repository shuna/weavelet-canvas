#!/usr/bin/env python3
"""Count export structure and byte lengths without printing user data.

Usage: python3 scripts/analyze-export.py backup.json.gz --output report.json
The expanded JSON lives in a temporary file removed on exit. Reports contain
only fixed metric names and numbers; no titles, IDs, hashes, paths or excerpts.
Delta patches are counted, never applied; token counts are not estimated.
"""

import argparse
import gzip
import json
import math
import resource
import sys
import tempfile
import time
from collections import Counter
from pathlib import Path


def distribution(values):
    values = sorted(values)
    if not values:
        return dict(count=0, total=0, min=0, p50=0, p95=0, p99=0, max=0)
    return dict(count=len(values), total=sum(values), min=values[0],
                **{f'p{p}': values[math.ceil(len(values) * p / 100) - 1]
                   for p in (50, 95, 99)}, max=values[-1])


def body_size(content):
    """Return stored text characters, UTF-8 bytes, image URL bytes and count."""
    if isinstance(content, str):
        return len(content), len(content.encode('utf-8')), 0, 0
    chars = text_bytes = image_bytes = images = 0
    for part in content if isinstance(content, list) else []:
        if not isinstance(part, dict):
            continue
        if part.get('type') == 'text' and isinstance(part.get('text'), str):
            chars += len(part['text'])
            text_bytes += len(part['text'].encode('utf-8'))
        elif part.get('type') == 'image_url':
            image = part.get('image_url')
            url = image.get('url') if isinstance(image, dict) else image
            if isinstance(url, str):
                images += 1
                image_bytes += len(url.encode('utf-8'))
    return chars, text_bytes, image_bytes, images


def tree_stats(nodes):
    children = Counter()
    roots = orphans = 0
    for node in nodes.values():
        parent = node.get('parentId')
        if parent is None or parent == '':
            roots += 1
        elif parent in nodes:
            children[parent] += 1
        else:
            orphans += 1
    depths = {}
    for start in nodes:
        current, path, seen = start, [], set()
        while current in nodes and current not in depths and current not in seen:
            seen.add(current)
            path.append(current)
            current = nodes[current].get('parentId')
        depth = depths.get(current, 0) if current not in nodes else depths.get(current, -1)
        if current not in (None, '') and current not in nodes:
            depth = -1
        for node_id in reversed(path):
            depth = depth + 1 if depth >= 0 else -1
            depths[node_id] = depth
    return dict(roots=roots, leaves=sum(not children[node_id] for node_id in nodes),
                branching_nodes=sum(n > 1 for n in children.values()),
                max_children=max(children.values(), default=0), orphan_nodes=orphans,
                cyclic_or_orphan_chain_nodes=sum(d < 0 for d in depths.values()),
                max_depth=max((d for d in depths.values() if d >= 0), default=0))


def analyze(document):
    if not isinstance(document, dict):
        raise ValueError('Unsupported export structure')
    state = document.get('state', document)
    if not isinstance(state, dict) or not isinstance(state.get('chats'), list):
        raise ValueError('Unsupported export structure')
    store = state.get('contentStore') or {}
    if not isinstance(store, dict):
        raise ValueError('Unsupported content store')
    node_counts, active_counts, legacy_counts, node_bytes, chat_bytes = [], [], [], [], []
    structures = []
    references = Counter()
    inline_bytes = unresolved = chats_with_trees = 0
    for chat in state['chats']:
        tree = chat.get('branchTree')
        messages = chat.get('messages') or []
        legacy_counts.append(len(messages))
        per_chat_bytes = 0
        if isinstance(tree, dict):
            chats_with_trees += 1
            nodes = tree.get('nodes') or {}
            node_counts.append(len(nodes))
            active_counts.append(len(tree.get('activePath') or []))
            structures.append(tree_stats(nodes))
            bodies = nodes.values()
        else:
            node_counts.append(len(messages))
            active_counts.append(len(messages))
            bodies = messages
        for node in bodies:
            content = node.get('content')
            content_hash = node.get('contentHash')
            if content_hash:
                references[content_hash] += 1
                entry = store.get(content_hash)
                if entry is None or entry.get('delta'):
                    unresolved += 1
                    continue
                content = entry.get('content')
            size = body_size(content)[1]
            if not content_hash:
                inline_bytes += size
            node_bytes.append(size)
            per_chat_bytes += size
        chat_bytes.append(per_chat_bytes)

    text_sizes, text_chars, image_sizes, image_counts, patch_sizes = [], [], [], [], []
    missing_bases = delta_entries = 0
    for entry in store.values():
        chars, text, image, count = body_size(entry.get('content'))
        text_chars.append(chars)
        text_sizes.append(text)
        image_sizes.append(image)
        image_counts.append(count)
        delta = entry.get('delta')
        if delta:
            delta_entries += 1
            patch_sizes.append(len(delta.get('patches', '').encode('utf-8')))
            missing_bases += delta.get('baseHash') not in store

    return dict(
        export_version=document.get('version') if isinstance(document.get('version'), (int, float)) else None,
        chats=len(state['chats']), chats_with_trees=chats_with_trees,
        branch_tree_nodes=sum(node_counts[i] for i, chat in enumerate(state['chats'])
                              if isinstance(chat.get('branchTree'), dict)),
        legacy_message_nodes=sum(node_counts[i] for i, chat in enumerate(state['chats'])
                                 if not isinstance(chat.get('branchTree'), dict)),
        nodes_per_chat=distribution(node_counts), active_nodes_per_chat=distribution(active_counts),
        materialized_messages_per_chat=distribution(legacy_counts),
        # messages on tree chats are materialized views, not additional nodes.
        branching=dict(
            **{key: sum(s[key] for s in structures) for key in
               ('roots', 'leaves', 'branching_nodes', 'orphan_nodes', 'cyclic_or_orphan_chain_nodes')},
            children_max=max((s['max_children'] for s in structures), default=0),
            depth_per_chat=distribution([s['max_depth'] for s in structures])),
        content=dict(entries=len(store), delta_entries=delta_entries,
                     full_entries=len(store) - delta_entries,
                     referenced_entries=len(references), references=sum(references.values()),
                     missing_references=sum(n for key, n in references.items() if key not in store),
                     transient_missing_references=sum(n for key, n in references.items()
                                                      if key not in store and key.startswith('__streaming:')),
                     nontransient_missing_references=sum(n for key, n in references.items()
                                                         if key not in store and not key.startswith('__streaming:')),
                     missing_delta_bases=missing_bases,
                     unique_stored_text_chars=sum(text_chars),
                     unique_stored_text_bytes=distribution(text_sizes),
                     unique_stored_image_url_bytes=sum(image_sizes), images=sum(image_counts),
                     delta_patch_utf8_bytes=distribution(patch_sizes),
                     inline_node_text_bytes=inline_bytes,
                     referenced_node_text_bytes=distribution(node_bytes),
                     node_text_bytes_per_chat=distribution(chat_bytes),
                     nodes_without_resolved_size=unresolved),
        safety_factor=3,
        design_capacity=dict(nodes=sum(node_counts) * 3,
                             node_sha256_binary_bytes=sum(node_counts) * 3 * 32))


def self_test():
    nodes = {'r': {'parentId': None, 'contentHash': 'a'},
             'x': {'parentId': 'r', 'contentHash': 'a'},
             'y': {'parentId': 'r', 'contentHash': 'd'}}
    data = {'version': 3, 'chats': [{'branchTree': {'nodes': nodes, 'activePath': ['r', 'x']},
                                  'messages': [{'content': 'materialized view'}]}],
            'contentStore': {'a': {'content': [{'type': 'text', 'text': 'あa'}]},
                             'd': {'content': [], 'delta': {'baseHash': 'a', 'patches': 'patch'}}}}
    report = analyze(data)
    assert report['nodes_per_chat']['total'] == 3
    assert report['branch_tree_nodes'] == 3 and report['legacy_message_nodes'] == 0
    assert report['branching']['leaves'] == 2
    assert report['branching']['depth_per_chat']['max'] == 2
    assert report['content']['unique_stored_text_bytes']['total'] == 4
    assert report['content']['referenced_node_text_bytes']['total'] == 8
    assert report['content']['nodes_without_resolved_size'] == 1
    assert 'materialized view' not in json.dumps(report)
    assert tree_stats({'a': {'parentId': 'b'}, 'b': {'parentId': 'a'}})['cyclic_or_orphan_chain_nodes'] == 2
    assert tree_stats({'a': {'parentId': 'missing'}})['orphan_nodes'] == 1
    deep = {str(i): {'parentId': str(i - 1) if i else None} for i in range(20000)}
    assert tree_stats(deep)['max_depth'] == 20000
    assert analyze({'chats': [{'messages': [{'content': 'abc'}]}]})['legacy_message_nodes'] == 1
    missing = analyze({'chats': [{'branchTree': {'nodes': {
        'a': {'contentHash': '__streaming:placeholder'}, 'b': {'contentHash': 'absent'}}}}]})
    assert missing['content']['transient_missing_references'] == 1
    assert missing['content']['nontransient_missing_references'] == 1
    print('self-test passed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', nargs='?', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if args.source is None:
        parser.error('source is required')
    if args.output and args.output.resolve() == args.source.resolve():
        parser.error('output must differ from source')
    started = time.perf_counter()
    with tempfile.TemporaryFile() as expanded:
        with gzip.open(args.source, 'rb') as source:
            while chunk := source.read(1024 * 1024):
                expanded.write(chunk)
        expanded_bytes = expanded.tell()
        decompressed = time.perf_counter()
        expanded.seek(0)
        # ponytail: one export is parsed in RAM; use streaming JSON when exports exceed RAM.
        document = json.load(expanded)
    parsed = time.perf_counter()
    report = analyze(document)
    report['file'] = dict(gzip_bytes=args.source.stat().st_size, expanded_json_bytes=expanded_bytes,
                          expansion_ratio=round(expanded_bytes / args.source.stat().st_size, 3))
    report['design_capacity']['expanded_json_bytes'] = expanded_bytes * 3
    report['measurement'] = dict(
        gzip_expand_seconds=round(decompressed - started, 3),
        json_parse_seconds=round(parsed - decompressed, 3),
        summarize_seconds=round(time.perf_counter() - parsed, 3),
        analyzer_peak_rss_bytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == 'darwin' else 1024))
    output = json.dumps(report, ensure_ascii=True, indent=2) + '\n'
    if args.output:
        args.output.write_text(output, encoding='utf-8')
    print(output, end='')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError, AttributeError, EOFError) as error:
        # Never print exception messages: JSON decoding errors can contain user data.
        print(f'Analysis failed ({type(error).__name__}); no content displayed.', file=sys.stderr)
        sys.exit(1)

import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const languageDataPath = join(root, 'src/constants/languageData.json');
const localeRoot = join(root, 'public/locales');
const nativeRoot = join(root, 'ios-rebuild/WeaveletPilot');
const catalogPath = join(nativeRoot, 'Localizable.xcstrings');
const webLanguagesPath = join(nativeRoot, 'WebLanguages.json');
const check = process.argv.slice(2).includes('--check');

// These native controls intentionally use wording different from the Web Japanese
// source. Keep the Web key explicit rather than guessing from duplicate Japanese text.
const nativeAliases = {
  '言語': 'main.settingsLabel.language',
  '自動': 'main.streamingMarkdownPolicy.auto',
  '一般': 'main.settingsTab.general',
  '会話設定': 'main.chatSettings',
  'ローカルモデル': 'main.settingsTab.localModels',
  'チャット': 'main.chat',
  '分岐エディター': 'main.branchEditor',
  '左右分割': 'main.splitHorizontal',
  '上下分割': 'main.splitVertical',
  '編集': 'main.branchEditorMenu.edit',
  '取消': 'main.cancel',
  'キャンセル': 'main.cancel',
  '保存': 'main.save',
  '閉じる': 'main.close',
  '設定': 'main.setting',
  '新規会話': 'main.newChat',
  '戻る': 'main.onboarding.back',
  '削除': 'main.localModel.delete',
  'すべて削除': 'main.localModel.opfsBrowser.clearAll',
  '生成': 'main.generate',
  '確認': 'main.confirm',
  '検索': 'main.search',
  'インポート': 'main.import',
  'エクスポート': 'main.export',
  'ユーザー': 'main.user',
  'アシスタント': 'main.assistant',
  'システム': 'main.system',
};

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

function flatten(value, prefix = '', result = new Map()) {
  if (typeof value === 'string') result.set(prefix, value);
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      flatten(value[key], prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

function fallbackChain(language, fallbackLanguage) {
  const result = [language];
  const base = language.split('-')[0];
  if (!result.includes(base)) result.push(base);
  if (!result.includes(fallbackLanguage)) result.push(fallbackLanguage);
  return result;
}

function nativeStrings(source) {
  const pattern = /\b(?:Text|Button|Section|Picker|Toggle|NavigationLink|Label)\(\s*"((?:\\.|[^"\\])*)"/g;
  const values = new Set();
  for (const match of source.matchAll(pattern)) {
    const value = match[1];
    // Interpolated and formatted strings need an explicit format-argument mapping.
    if (value.includes('\\(') || value.includes('%')) continue;
    values.add(value.replaceAll('\\"', '"').replaceAll('\\n', '\n'));
  }
  return values;
}

async function readJSON(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function update(path, contents) {
  let current = null;
  try { current = await readFile(path, 'utf8'); } catch { }
  if (current === contents) return false;
  if (check) {
    console.error(`${relative(root, path)} is out of date`);
    process.exitCode = 1;
    return false;
  }
  await writeFile(path, contents);
  return true;
}

const languageData = await readJSON(languageDataPath);
const { i18nLanguages, selectableLanguages, languageCodeToName, fallbackLanguage } = languageData;
if (!Array.isArray(i18nLanguages) || !Array.isArray(selectableLanguages) || typeof fallbackLanguage !== 'string') {
  throw new Error('languageData.json is invalid');
}
for (const language of [...i18nLanguages, ...selectableLanguages, fallbackLanguage]) {
  if (typeof language !== 'string' || !(language in languageCodeToName)) {
    throw new Error(`languageData.json has an unknown language: ${language}`);
  }
}

const translations = new Map();
for (const language of i18nLanguages) {
  const directory = join(localeRoot, language);
  const entries = new Map();
  for (const path of (await files(directory)).filter(path => extname(path) === '.json')) {
    const namespace = relative(directory, path).replace(/\.json$/, '').replaceAll('\\', '/').replaceAll('/', '.');
    for (const [key, value] of flatten(await readJSON(path))) entries.set(`${namespace}.${key}`, value);
  }
  translations.set(language, entries);
}

const japanese = translations.get('ja');
if (!japanese) throw new Error('Japanese Web locale is required');
const candidates = new Map();
for (const [key, value] of japanese) {
  // Diagnostic completion states do not provide a dismissal-button translation.
  if (key.startsWith('drive.debug.') || key.startsWith('cloudkit.debug.')) continue;
  const values = candidates.get(value) ?? [];
  values.push(key);
  candidates.set(value, values);
}

const literals = new Set();
for (const path of (await files(nativeRoot)).filter(path => extname(path) === '.swift')) {
  for (const value of nativeStrings(await readFile(path, 'utf8'))) literals.add(value);
}

// Explicit aliases also cover closed-enum labels passed through LocalizedStringKey.
for (const literal of Object.keys(nativeAliases)) literals.add(literal);

const selected = new Map();
const unresolved = [];
for (const literal of [...literals].sort((left, right) => left.localeCompare(right, 'ja'))) {
  const alias = nativeAliases[literal];
  const matches = alias ? [alias] : candidates.get(literal) ?? [];
  if (matches.length !== 1 || !japanese.has(matches[0])) {
    unresolved.push(literal);
    continue;
  }
  selected.set(literal, matches[0]);
}

const strings = {};
for (const [literal, key] of [...selected].sort(([left], [right]) => left.localeCompare(right, 'ja'))) {
  const localizations = {};
  for (const language of i18nLanguages) {
    let value;
    for (const candidate of fallbackChain(language, fallbackLanguage)) {
      value = translations.get(candidate)?.get(key);
      if (value !== undefined) break;
    }
    if (value === undefined) throw new Error(`No ${fallbackLanguage} translation for ${key}`);
    localizations[language] = { stringUnit: { state: 'translated', value: language === 'ja' ? literal : value } };
  }
  strings[literal] = {
    extractionState: 'manual',
    comment: `Web locale key: ${key}`,
    localizations,
  };
}

const catalog = { sourceLanguage: 'ja', strings, version: '1.0' };
const webLanguages = { i18nLanguages, selectableLanguages, languageCodeToName, fallbackLanguage };
const catalogChanged = await update(catalogPath, json(catalog));
const languagesChanged = await update(webLanguagesPath, json(webLanguages));
console.log(`native localizations: ${selected.size} translated, ${unresolved.length} unresolved native literals${catalogChanged || languagesChanged ? ' (updated)' : ''}`);

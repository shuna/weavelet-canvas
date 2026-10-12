// Fixed JSON semantics and delta adapter; caller input is passed only as values.
var WeaveletRecords = {
  stringify: function (json) { return JSON.stringify(JSON.parse(json)); },
  canonical: function (json) {
    function canonical(value) {
      if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
      if (value !== null && typeof value === 'object') {
        return '{' + Object.keys(value).sort().map(function (key) {
          return JSON.stringify(key) + ':' + canonical(value[key]);
        }).join(',') + '}';
      }
      return JSON.stringify(value);
    }
    return canonical(JSON.parse(json));
  },
  localHash: function (json) {
    var text = JSON.stringify(JSON.parse(json));
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(36);
  },
  applyDelta: function (baseJSON, patches) {
    var dmp = new WeaveletDMP.DiffMatchPatch();
    var result = dmp.patch_apply(dmp.patch_fromText(patches), JSON.stringify(JSON.parse(baseJSON)));
    if (result[1].some(function (ok) { return !ok; })) throw new Error('Invalid message delta');
    return JSON.stringify(JSON.parse(result[0]));
  }
};

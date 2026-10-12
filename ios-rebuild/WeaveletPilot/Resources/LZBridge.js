// Only this fixed bridge and the bundled lz-string source are evaluated.
var WeaveletLZ = {
  compressGoogle: function (text) {
    return Array.prototype.slice.call(LZString.compressToUint8Array(text));
  },
  decompressGoogle: function (bytes) {
    var text = LZString.decompressFromUint8Array(new Uint8Array(bytes));
    if (typeof text !== 'string') throw new Error('Invalid compressed data');
    return text;
  },
  compressCloudKit: function (text) {
    var compressed = LZString.compress(text);
    var bytes = [];
    for (var i = 0; i < compressed.length; i++) {
      var unit = compressed.charCodeAt(i);
      bytes.push(unit & 255, unit >>> 8);
    }
    return bytes;
  },
  decompressCloudKit: function (bytes) {
    var units = [];
    for (var i = 0; i < bytes.length; i += 2) {
      units.push(String.fromCharCode(bytes[i] | (bytes[i + 1] << 8)));
    }
    var text = LZString.decompress(units.join(''));
    if (typeof text !== 'string') throw new Error('Invalid compressed data');
    return text;
  }
};

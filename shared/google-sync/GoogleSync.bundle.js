"use strict";
var WeaveletGoogleSync = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../../../Users/suzuki/weavelet-canvas/node_modules/lodash/lodash.js
  var require_lodash = __commonJS({
    "../../../Users/suzuki/weavelet-canvas/node_modules/lodash/lodash.js"(exports, module) {
      /**
       * @license
       * Lodash <https://lodash.com/>
       * Copyright OpenJS Foundation and other contributors <https://openjsf.org/>
       * Released under MIT license <https://lodash.com/license>
       * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
       * Copyright Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
       */
      (function() {
        var undefined2;
        var VERSION = "4.17.21";
        var LARGE_ARRAY_SIZE = 200;
        var CORE_ERROR_TEXT = "Unsupported core-js use. Try https://npms.io/search?q=ponyfill.", FUNC_ERROR_TEXT = "Expected a function", INVALID_TEMPL_VAR_ERROR_TEXT = "Invalid `variable` option passed into `_.template`";
        var HASH_UNDEFINED = "__lodash_hash_undefined__";
        var MAX_MEMOIZE_SIZE = 500;
        var PLACEHOLDER = "__lodash_placeholder__";
        var CLONE_DEEP_FLAG = 1, CLONE_FLAT_FLAG = 2, CLONE_SYMBOLS_FLAG = 4;
        var COMPARE_PARTIAL_FLAG = 1, COMPARE_UNORDERED_FLAG = 2;
        var WRAP_BIND_FLAG = 1, WRAP_BIND_KEY_FLAG = 2, WRAP_CURRY_BOUND_FLAG = 4, WRAP_CURRY_FLAG = 8, WRAP_CURRY_RIGHT_FLAG = 16, WRAP_PARTIAL_FLAG = 32, WRAP_PARTIAL_RIGHT_FLAG = 64, WRAP_ARY_FLAG = 128, WRAP_REARG_FLAG = 256, WRAP_FLIP_FLAG = 512;
        var DEFAULT_TRUNC_LENGTH = 30, DEFAULT_TRUNC_OMISSION = "...";
        var HOT_COUNT = 800, HOT_SPAN = 16;
        var LAZY_FILTER_FLAG = 1, LAZY_MAP_FLAG = 2, LAZY_WHILE_FLAG = 3;
        var INFINITY = 1 / 0, MAX_SAFE_INTEGER = 9007199254740991, MAX_INTEGER = 17976931348623157e292, NAN = 0 / 0;
        var MAX_ARRAY_LENGTH = 4294967295, MAX_ARRAY_INDEX = MAX_ARRAY_LENGTH - 1, HALF_MAX_ARRAY_LENGTH = MAX_ARRAY_LENGTH >>> 1;
        var wrapFlags = [
          ["ary", WRAP_ARY_FLAG],
          ["bind", WRAP_BIND_FLAG],
          ["bindKey", WRAP_BIND_KEY_FLAG],
          ["curry", WRAP_CURRY_FLAG],
          ["curryRight", WRAP_CURRY_RIGHT_FLAG],
          ["flip", WRAP_FLIP_FLAG],
          ["partial", WRAP_PARTIAL_FLAG],
          ["partialRight", WRAP_PARTIAL_RIGHT_FLAG],
          ["rearg", WRAP_REARG_FLAG]
        ];
        var argsTag = "[object Arguments]", arrayTag = "[object Array]", asyncTag = "[object AsyncFunction]", boolTag = "[object Boolean]", dateTag = "[object Date]", domExcTag = "[object DOMException]", errorTag = "[object Error]", funcTag = "[object Function]", genTag = "[object GeneratorFunction]", mapTag = "[object Map]", numberTag = "[object Number]", nullTag = "[object Null]", objectTag = "[object Object]", promiseTag = "[object Promise]", proxyTag = "[object Proxy]", regexpTag = "[object RegExp]", setTag = "[object Set]", stringTag = "[object String]", symbolTag = "[object Symbol]", undefinedTag = "[object Undefined]", weakMapTag = "[object WeakMap]", weakSetTag = "[object WeakSet]";
        var arrayBufferTag = "[object ArrayBuffer]", dataViewTag = "[object DataView]", float32Tag = "[object Float32Array]", float64Tag = "[object Float64Array]", int8Tag = "[object Int8Array]", int16Tag = "[object Int16Array]", int32Tag = "[object Int32Array]", uint8Tag = "[object Uint8Array]", uint8ClampedTag = "[object Uint8ClampedArray]", uint16Tag = "[object Uint16Array]", uint32Tag = "[object Uint32Array]";
        var reEmptyStringLeading = /\b__p \+= '';/g, reEmptyStringMiddle = /\b(__p \+=) '' \+/g, reEmptyStringTrailing = /(__e\(.*?\)|\b__t\)) \+\n'';/g;
        var reEscapedHtml = /&(?:amp|lt|gt|quot|#39);/g, reUnescapedHtml = /[&<>"']/g, reHasEscapedHtml = RegExp(reEscapedHtml.source), reHasUnescapedHtml = RegExp(reUnescapedHtml.source);
        var reEscape = /<%-([\s\S]+?)%>/g, reEvaluate = /<%([\s\S]+?)%>/g, reInterpolate = /<%=([\s\S]+?)%>/g;
        var reIsDeepProp = /\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/, reIsPlainProp = /^\w*$/, rePropName = /[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g;
        var reRegExpChar = /[\\^$.*+?()[\]{}|]/g, reHasRegExpChar = RegExp(reRegExpChar.source);
        var reTrimStart = /^\s+/;
        var reWhitespace = /\s/;
        var reWrapComment = /\{(?:\n\/\* \[wrapped with .+\] \*\/)?\n?/, reWrapDetails = /\{\n\/\* \[wrapped with (.+)\] \*/, reSplitDetails = /,? & /;
        var reAsciiWord = /[^\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g;
        var reForbiddenIdentifierChars = /[()=,{}\[\]\/\s]/;
        var reEscapeChar = /\\(\\)?/g;
        var reEsTemplate = /\$\{([^\\}]*(?:\\.[^\\}]*)*)\}/g;
        var reFlags = /\w*$/;
        var reIsBadHex = /^[-+]0x[0-9a-f]+$/i;
        var reIsBinary = /^0b[01]+$/i;
        var reIsHostCtor = /^\[object .+?Constructor\]$/;
        var reIsOctal = /^0o[0-7]+$/i;
        var reIsUint = /^(?:0|[1-9]\d*)$/;
        var reLatin = /[\xc0-\xd6\xd8-\xf6\xf8-\xff\u0100-\u017f]/g;
        var reNoMatch = /($^)/;
        var reUnescapedString = /['\n\r\u2028\u2029\\]/g;
        var rsAstralRange = "\\ud800-\\udfff", rsComboMarksRange = "\\u0300-\\u036f", reComboHalfMarksRange = "\\ufe20-\\ufe2f", rsComboSymbolsRange = "\\u20d0-\\u20ff", rsComboRange = rsComboMarksRange + reComboHalfMarksRange + rsComboSymbolsRange, rsDingbatRange = "\\u2700-\\u27bf", rsLowerRange = "a-z\\xdf-\\xf6\\xf8-\\xff", rsMathOpRange = "\\xac\\xb1\\xd7\\xf7", rsNonCharRange = "\\x00-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\xbf", rsPunctuationRange = "\\u2000-\\u206f", rsSpaceRange = " \\t\\x0b\\f\\xa0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u180e\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u202f\\u205f\\u3000", rsUpperRange = "A-Z\\xc0-\\xd6\\xd8-\\xde", rsVarRange = "\\ufe0e\\ufe0f", rsBreakRange = rsMathOpRange + rsNonCharRange + rsPunctuationRange + rsSpaceRange;
        var rsApos = "['\u2019]", rsAstral = "[" + rsAstralRange + "]", rsBreak = "[" + rsBreakRange + "]", rsCombo = "[" + rsComboRange + "]", rsDigits = "\\d+", rsDingbat = "[" + rsDingbatRange + "]", rsLower = "[" + rsLowerRange + "]", rsMisc = "[^" + rsAstralRange + rsBreakRange + rsDigits + rsDingbatRange + rsLowerRange + rsUpperRange + "]", rsFitz = "\\ud83c[\\udffb-\\udfff]", rsModifier = "(?:" + rsCombo + "|" + rsFitz + ")", rsNonAstral = "[^" + rsAstralRange + "]", rsRegional = "(?:\\ud83c[\\udde6-\\uddff]){2}", rsSurrPair = "[\\ud800-\\udbff][\\udc00-\\udfff]", rsUpper = "[" + rsUpperRange + "]", rsZWJ = "\\u200d";
        var rsMiscLower = "(?:" + rsLower + "|" + rsMisc + ")", rsMiscUpper = "(?:" + rsUpper + "|" + rsMisc + ")", rsOptContrLower = "(?:" + rsApos + "(?:d|ll|m|re|s|t|ve))?", rsOptContrUpper = "(?:" + rsApos + "(?:D|LL|M|RE|S|T|VE))?", reOptMod = rsModifier + "?", rsOptVar = "[" + rsVarRange + "]?", rsOptJoin = "(?:" + rsZWJ + "(?:" + [rsNonAstral, rsRegional, rsSurrPair].join("|") + ")" + rsOptVar + reOptMod + ")*", rsOrdLower = "\\d*(?:1st|2nd|3rd|(?![123])\\dth)(?=\\b|[A-Z_])", rsOrdUpper = "\\d*(?:1ST|2ND|3RD|(?![123])\\dTH)(?=\\b|[a-z_])", rsSeq = rsOptVar + reOptMod + rsOptJoin, rsEmoji = "(?:" + [rsDingbat, rsRegional, rsSurrPair].join("|") + ")" + rsSeq, rsSymbol = "(?:" + [rsNonAstral + rsCombo + "?", rsCombo, rsRegional, rsSurrPair, rsAstral].join("|") + ")";
        var reApos = RegExp(rsApos, "g");
        var reComboMark = RegExp(rsCombo, "g");
        var reUnicode = RegExp(rsFitz + "(?=" + rsFitz + ")|" + rsSymbol + rsSeq, "g");
        var reUnicodeWord = RegExp([
          rsUpper + "?" + rsLower + "+" + rsOptContrLower + "(?=" + [rsBreak, rsUpper, "$"].join("|") + ")",
          rsMiscUpper + "+" + rsOptContrUpper + "(?=" + [rsBreak, rsUpper + rsMiscLower, "$"].join("|") + ")",
          rsUpper + "?" + rsMiscLower + "+" + rsOptContrLower,
          rsUpper + "+" + rsOptContrUpper,
          rsOrdUpper,
          rsOrdLower,
          rsDigits,
          rsEmoji
        ].join("|"), "g");
        var reHasUnicode = RegExp("[" + rsZWJ + rsAstralRange + rsComboRange + rsVarRange + "]");
        var reHasUnicodeWord = /[a-z][A-Z]|[A-Z]{2}[a-z]|[0-9][a-zA-Z]|[a-zA-Z][0-9]|[^a-zA-Z0-9 ]/;
        var contextProps = [
          "Array",
          "Buffer",
          "DataView",
          "Date",
          "Error",
          "Float32Array",
          "Float64Array",
          "Function",
          "Int8Array",
          "Int16Array",
          "Int32Array",
          "Map",
          "Math",
          "Object",
          "Promise",
          "RegExp",
          "Set",
          "String",
          "Symbol",
          "TypeError",
          "Uint8Array",
          "Uint8ClampedArray",
          "Uint16Array",
          "Uint32Array",
          "WeakMap",
          "_",
          "clearTimeout",
          "isFinite",
          "parseInt",
          "setTimeout"
        ];
        var templateCounter = -1;
        var typedArrayTags = {};
        typedArrayTags[float32Tag] = typedArrayTags[float64Tag] = typedArrayTags[int8Tag] = typedArrayTags[int16Tag] = typedArrayTags[int32Tag] = typedArrayTags[uint8Tag] = typedArrayTags[uint8ClampedTag] = typedArrayTags[uint16Tag] = typedArrayTags[uint32Tag] = true;
        typedArrayTags[argsTag] = typedArrayTags[arrayTag] = typedArrayTags[arrayBufferTag] = typedArrayTags[boolTag] = typedArrayTags[dataViewTag] = typedArrayTags[dateTag] = typedArrayTags[errorTag] = typedArrayTags[funcTag] = typedArrayTags[mapTag] = typedArrayTags[numberTag] = typedArrayTags[objectTag] = typedArrayTags[regexpTag] = typedArrayTags[setTag] = typedArrayTags[stringTag] = typedArrayTags[weakMapTag] = false;
        var cloneableTags = {};
        cloneableTags[argsTag] = cloneableTags[arrayTag] = cloneableTags[arrayBufferTag] = cloneableTags[dataViewTag] = cloneableTags[boolTag] = cloneableTags[dateTag] = cloneableTags[float32Tag] = cloneableTags[float64Tag] = cloneableTags[int8Tag] = cloneableTags[int16Tag] = cloneableTags[int32Tag] = cloneableTags[mapTag] = cloneableTags[numberTag] = cloneableTags[objectTag] = cloneableTags[regexpTag] = cloneableTags[setTag] = cloneableTags[stringTag] = cloneableTags[symbolTag] = cloneableTags[uint8Tag] = cloneableTags[uint8ClampedTag] = cloneableTags[uint16Tag] = cloneableTags[uint32Tag] = true;
        cloneableTags[errorTag] = cloneableTags[funcTag] = cloneableTags[weakMapTag] = false;
        var deburredLetters = {
          // Latin-1 Supplement block.
          "\xC0": "A",
          "\xC1": "A",
          "\xC2": "A",
          "\xC3": "A",
          "\xC4": "A",
          "\xC5": "A",
          "\xE0": "a",
          "\xE1": "a",
          "\xE2": "a",
          "\xE3": "a",
          "\xE4": "a",
          "\xE5": "a",
          "\xC7": "C",
          "\xE7": "c",
          "\xD0": "D",
          "\xF0": "d",
          "\xC8": "E",
          "\xC9": "E",
          "\xCA": "E",
          "\xCB": "E",
          "\xE8": "e",
          "\xE9": "e",
          "\xEA": "e",
          "\xEB": "e",
          "\xCC": "I",
          "\xCD": "I",
          "\xCE": "I",
          "\xCF": "I",
          "\xEC": "i",
          "\xED": "i",
          "\xEE": "i",
          "\xEF": "i",
          "\xD1": "N",
          "\xF1": "n",
          "\xD2": "O",
          "\xD3": "O",
          "\xD4": "O",
          "\xD5": "O",
          "\xD6": "O",
          "\xD8": "O",
          "\xF2": "o",
          "\xF3": "o",
          "\xF4": "o",
          "\xF5": "o",
          "\xF6": "o",
          "\xF8": "o",
          "\xD9": "U",
          "\xDA": "U",
          "\xDB": "U",
          "\xDC": "U",
          "\xF9": "u",
          "\xFA": "u",
          "\xFB": "u",
          "\xFC": "u",
          "\xDD": "Y",
          "\xFD": "y",
          "\xFF": "y",
          "\xC6": "Ae",
          "\xE6": "ae",
          "\xDE": "Th",
          "\xFE": "th",
          "\xDF": "ss",
          // Latin Extended-A block.
          "\u0100": "A",
          "\u0102": "A",
          "\u0104": "A",
          "\u0101": "a",
          "\u0103": "a",
          "\u0105": "a",
          "\u0106": "C",
          "\u0108": "C",
          "\u010A": "C",
          "\u010C": "C",
          "\u0107": "c",
          "\u0109": "c",
          "\u010B": "c",
          "\u010D": "c",
          "\u010E": "D",
          "\u0110": "D",
          "\u010F": "d",
          "\u0111": "d",
          "\u0112": "E",
          "\u0114": "E",
          "\u0116": "E",
          "\u0118": "E",
          "\u011A": "E",
          "\u0113": "e",
          "\u0115": "e",
          "\u0117": "e",
          "\u0119": "e",
          "\u011B": "e",
          "\u011C": "G",
          "\u011E": "G",
          "\u0120": "G",
          "\u0122": "G",
          "\u011D": "g",
          "\u011F": "g",
          "\u0121": "g",
          "\u0123": "g",
          "\u0124": "H",
          "\u0126": "H",
          "\u0125": "h",
          "\u0127": "h",
          "\u0128": "I",
          "\u012A": "I",
          "\u012C": "I",
          "\u012E": "I",
          "\u0130": "I",
          "\u0129": "i",
          "\u012B": "i",
          "\u012D": "i",
          "\u012F": "i",
          "\u0131": "i",
          "\u0134": "J",
          "\u0135": "j",
          "\u0136": "K",
          "\u0137": "k",
          "\u0138": "k",
          "\u0139": "L",
          "\u013B": "L",
          "\u013D": "L",
          "\u013F": "L",
          "\u0141": "L",
          "\u013A": "l",
          "\u013C": "l",
          "\u013E": "l",
          "\u0140": "l",
          "\u0142": "l",
          "\u0143": "N",
          "\u0145": "N",
          "\u0147": "N",
          "\u014A": "N",
          "\u0144": "n",
          "\u0146": "n",
          "\u0148": "n",
          "\u014B": "n",
          "\u014C": "O",
          "\u014E": "O",
          "\u0150": "O",
          "\u014D": "o",
          "\u014F": "o",
          "\u0151": "o",
          "\u0154": "R",
          "\u0156": "R",
          "\u0158": "R",
          "\u0155": "r",
          "\u0157": "r",
          "\u0159": "r",
          "\u015A": "S",
          "\u015C": "S",
          "\u015E": "S",
          "\u0160": "S",
          "\u015B": "s",
          "\u015D": "s",
          "\u015F": "s",
          "\u0161": "s",
          "\u0162": "T",
          "\u0164": "T",
          "\u0166": "T",
          "\u0163": "t",
          "\u0165": "t",
          "\u0167": "t",
          "\u0168": "U",
          "\u016A": "U",
          "\u016C": "U",
          "\u016E": "U",
          "\u0170": "U",
          "\u0172": "U",
          "\u0169": "u",
          "\u016B": "u",
          "\u016D": "u",
          "\u016F": "u",
          "\u0171": "u",
          "\u0173": "u",
          "\u0174": "W",
          "\u0175": "w",
          "\u0176": "Y",
          "\u0177": "y",
          "\u0178": "Y",
          "\u0179": "Z",
          "\u017B": "Z",
          "\u017D": "Z",
          "\u017A": "z",
          "\u017C": "z",
          "\u017E": "z",
          "\u0132": "IJ",
          "\u0133": "ij",
          "\u0152": "Oe",
          "\u0153": "oe",
          "\u0149": "'n",
          "\u017F": "s"
        };
        var htmlEscapes = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        };
        var htmlUnescapes = {
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&#39;": "'"
        };
        var stringEscapes = {
          "\\": "\\",
          "'": "'",
          "\n": "n",
          "\r": "r",
          "\u2028": "u2028",
          "\u2029": "u2029"
        };
        var freeParseFloat = parseFloat, freeParseInt = parseInt;
        var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
        var freeSelf = typeof self == "object" && self && self.Object === Object && self;
        var root = freeGlobal || freeSelf || Function("return this")();
        var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
        var freeModule = freeExports && typeof module == "object" && module && !module.nodeType && module;
        var moduleExports = freeModule && freeModule.exports === freeExports;
        var freeProcess = moduleExports && freeGlobal.process;
        var nodeUtil = function() {
          try {
            var types = freeModule && freeModule.require && freeModule.require("util").types;
            if (types) {
              return types;
            }
            return freeProcess && freeProcess.binding && freeProcess.binding("util");
          } catch (e) {
          }
        }();
        var nodeIsArrayBuffer = nodeUtil && nodeUtil.isArrayBuffer, nodeIsDate = nodeUtil && nodeUtil.isDate, nodeIsMap = nodeUtil && nodeUtil.isMap, nodeIsRegExp = nodeUtil && nodeUtil.isRegExp, nodeIsSet = nodeUtil && nodeUtil.isSet, nodeIsTypedArray = nodeUtil && nodeUtil.isTypedArray;
        function apply(func, thisArg, args) {
          switch (args.length) {
            case 0:
              return func.call(thisArg);
            case 1:
              return func.call(thisArg, args[0]);
            case 2:
              return func.call(thisArg, args[0], args[1]);
            case 3:
              return func.call(thisArg, args[0], args[1], args[2]);
          }
          return func.apply(thisArg, args);
        }
        function arrayAggregator(array, setter, iteratee, accumulator) {
          var index = -1, length = array == null ? 0 : array.length;
          while (++index < length) {
            var value = array[index];
            setter(accumulator, value, iteratee(value), array);
          }
          return accumulator;
        }
        function arrayEach(array, iteratee) {
          var index = -1, length = array == null ? 0 : array.length;
          while (++index < length) {
            if (iteratee(array[index], index, array) === false) {
              break;
            }
          }
          return array;
        }
        function arrayEachRight(array, iteratee) {
          var length = array == null ? 0 : array.length;
          while (length--) {
            if (iteratee(array[length], length, array) === false) {
              break;
            }
          }
          return array;
        }
        function arrayEvery(array, predicate) {
          var index = -1, length = array == null ? 0 : array.length;
          while (++index < length) {
            if (!predicate(array[index], index, array)) {
              return false;
            }
          }
          return true;
        }
        function arrayFilter(array, predicate) {
          var index = -1, length = array == null ? 0 : array.length, resIndex = 0, result3 = [];
          while (++index < length) {
            var value = array[index];
            if (predicate(value, index, array)) {
              result3[resIndex++] = value;
            }
          }
          return result3;
        }
        function arrayIncludes(array, value) {
          var length = array == null ? 0 : array.length;
          return !!length && baseIndexOf(array, value, 0) > -1;
        }
        function arrayIncludesWith(array, value, comparator) {
          var index = -1, length = array == null ? 0 : array.length;
          while (++index < length) {
            if (comparator(value, array[index])) {
              return true;
            }
          }
          return false;
        }
        function arrayMap(array, iteratee) {
          var index = -1, length = array == null ? 0 : array.length, result3 = Array(length);
          while (++index < length) {
            result3[index] = iteratee(array[index], index, array);
          }
          return result3;
        }
        function arrayPush(array, values) {
          var index = -1, length = values.length, offset = array.length;
          while (++index < length) {
            array[offset + index] = values[index];
          }
          return array;
        }
        function arrayReduce(array, iteratee, accumulator, initAccum) {
          var index = -1, length = array == null ? 0 : array.length;
          if (initAccum && length) {
            accumulator = array[++index];
          }
          while (++index < length) {
            accumulator = iteratee(accumulator, array[index], index, array);
          }
          return accumulator;
        }
        function arrayReduceRight(array, iteratee, accumulator, initAccum) {
          var length = array == null ? 0 : array.length;
          if (initAccum && length) {
            accumulator = array[--length];
          }
          while (length--) {
            accumulator = iteratee(accumulator, array[length], length, array);
          }
          return accumulator;
        }
        function arraySome(array, predicate) {
          var index = -1, length = array == null ? 0 : array.length;
          while (++index < length) {
            if (predicate(array[index], index, array)) {
              return true;
            }
          }
          return false;
        }
        var asciiSize = baseProperty("length");
        function asciiToArray(string) {
          return string.split("");
        }
        function asciiWords(string) {
          return string.match(reAsciiWord) || [];
        }
        function baseFindKey(collection, predicate, eachFunc) {
          var result3;
          eachFunc(collection, function(value, key, collection2) {
            if (predicate(value, key, collection2)) {
              result3 = key;
              return false;
            }
          });
          return result3;
        }
        function baseFindIndex(array, predicate, fromIndex, fromRight) {
          var length = array.length, index = fromIndex + (fromRight ? 1 : -1);
          while (fromRight ? index-- : ++index < length) {
            if (predicate(array[index], index, array)) {
              return index;
            }
          }
          return -1;
        }
        function baseIndexOf(array, value, fromIndex) {
          return value === value ? strictIndexOf(array, value, fromIndex) : baseFindIndex(array, baseIsNaN, fromIndex);
        }
        function baseIndexOfWith(array, value, fromIndex, comparator) {
          var index = fromIndex - 1, length = array.length;
          while (++index < length) {
            if (comparator(array[index], value)) {
              return index;
            }
          }
          return -1;
        }
        function baseIsNaN(value) {
          return value !== value;
        }
        function baseMean(array, iteratee) {
          var length = array == null ? 0 : array.length;
          return length ? baseSum(array, iteratee) / length : NAN;
        }
        function baseProperty(key) {
          return function(object2) {
            return object2 == null ? undefined2 : object2[key];
          };
        }
        function basePropertyOf(object2) {
          return function(key) {
            return object2 == null ? undefined2 : object2[key];
          };
        }
        function baseReduce(collection, iteratee, accumulator, initAccum, eachFunc) {
          eachFunc(collection, function(value, index, collection2) {
            accumulator = initAccum ? (initAccum = false, value) : iteratee(accumulator, value, index, collection2);
          });
          return accumulator;
        }
        function baseSortBy(array, comparer) {
          var length = array.length;
          array.sort(comparer);
          while (length--) {
            array[length] = array[length].value;
          }
          return array;
        }
        function baseSum(array, iteratee) {
          var result3, index = -1, length = array.length;
          while (++index < length) {
            var current = iteratee(array[index]);
            if (current !== undefined2) {
              result3 = result3 === undefined2 ? current : result3 + current;
            }
          }
          return result3;
        }
        function baseTimes(n, iteratee) {
          var index = -1, result3 = Array(n);
          while (++index < n) {
            result3[index] = iteratee(index);
          }
          return result3;
        }
        function baseToPairs(object2, props) {
          return arrayMap(props, function(key) {
            return [key, object2[key]];
          });
        }
        function baseTrim(string) {
          return string ? string.slice(0, trimmedEndIndex(string) + 1).replace(reTrimStart, "") : string;
        }
        function baseUnary(func) {
          return function(value) {
            return func(value);
          };
        }
        function baseValues(object2, props) {
          return arrayMap(props, function(key) {
            return object2[key];
          });
        }
        function cacheHas(cache, key) {
          return cache.has(key);
        }
        function charsStartIndex(strSymbols, chrSymbols) {
          var index = -1, length = strSymbols.length;
          while (++index < length && baseIndexOf(chrSymbols, strSymbols[index], 0) > -1) {
          }
          return index;
        }
        function charsEndIndex(strSymbols, chrSymbols) {
          var index = strSymbols.length;
          while (index-- && baseIndexOf(chrSymbols, strSymbols[index], 0) > -1) {
          }
          return index;
        }
        function countHolders(array, placeholder) {
          var length = array.length, result3 = 0;
          while (length--) {
            if (array[length] === placeholder) {
              ++result3;
            }
          }
          return result3;
        }
        var deburrLetter = basePropertyOf(deburredLetters);
        var escapeHtmlChar = basePropertyOf(htmlEscapes);
        function escapeStringChar(chr) {
          return "\\" + stringEscapes[chr];
        }
        function getValue(object2, key) {
          return object2 == null ? undefined2 : object2[key];
        }
        function hasUnicode(string) {
          return reHasUnicode.test(string);
        }
        function hasUnicodeWord(string) {
          return reHasUnicodeWord.test(string);
        }
        function iteratorToArray(iterator) {
          var data, result3 = [];
          while (!(data = iterator.next()).done) {
            result3.push(data.value);
          }
          return result3;
        }
        function mapToArray(map) {
          var index = -1, result3 = Array(map.size);
          map.forEach(function(value, key) {
            result3[++index] = [key, value];
          });
          return result3;
        }
        function overArg(func, transform) {
          return function(arg) {
            return func(transform(arg));
          };
        }
        function replaceHolders(array, placeholder) {
          var index = -1, length = array.length, resIndex = 0, result3 = [];
          while (++index < length) {
            var value = array[index];
            if (value === placeholder || value === PLACEHOLDER) {
              array[index] = PLACEHOLDER;
              result3[resIndex++] = index;
            }
          }
          return result3;
        }
        function setToArray(set) {
          var index = -1, result3 = Array(set.size);
          set.forEach(function(value) {
            result3[++index] = value;
          });
          return result3;
        }
        function setToPairs(set) {
          var index = -1, result3 = Array(set.size);
          set.forEach(function(value) {
            result3[++index] = [value, value];
          });
          return result3;
        }
        function strictIndexOf(array, value, fromIndex) {
          var index = fromIndex - 1, length = array.length;
          while (++index < length) {
            if (array[index] === value) {
              return index;
            }
          }
          return -1;
        }
        function strictLastIndexOf(array, value, fromIndex) {
          var index = fromIndex + 1;
          while (index--) {
            if (array[index] === value) {
              return index;
            }
          }
          return index;
        }
        function stringSize(string) {
          return hasUnicode(string) ? unicodeSize(string) : asciiSize(string);
        }
        function stringToArray(string) {
          return hasUnicode(string) ? unicodeToArray(string) : asciiToArray(string);
        }
        function trimmedEndIndex(string) {
          var index = string.length;
          while (index-- && reWhitespace.test(string.charAt(index))) {
          }
          return index;
        }
        var unescapeHtmlChar = basePropertyOf(htmlUnescapes);
        function unicodeSize(string) {
          var result3 = reUnicode.lastIndex = 0;
          while (reUnicode.test(string)) {
            ++result3;
          }
          return result3;
        }
        function unicodeToArray(string) {
          return string.match(reUnicode) || [];
        }
        function unicodeWords(string) {
          return string.match(reUnicodeWord) || [];
        }
        var runInContext = function runInContext2(context) {
          context = context == null ? root : _23.defaults(root.Object(), context, _23.pick(root, contextProps));
          var Array2 = context.Array, Date2 = context.Date, Error2 = context.Error, Function2 = context.Function, Math2 = context.Math, Object2 = context.Object, RegExp2 = context.RegExp, String2 = context.String, TypeError2 = context.TypeError;
          var arrayProto = Array2.prototype, funcProto = Function2.prototype, objectProto = Object2.prototype;
          var coreJsData = context["__core-js_shared__"];
          var funcToString = funcProto.toString;
          var hasOwnProperty = objectProto.hasOwnProperty;
          var idCounter = 0;
          var maskSrcKey = function() {
            var uid = /[^.]+$/.exec(coreJsData && coreJsData.keys && coreJsData.keys.IE_PROTO || "");
            return uid ? "Symbol(src)_1." + uid : "";
          }();
          var nativeObjectToString = objectProto.toString;
          var objectCtorString = funcToString.call(Object2);
          var oldDash = root._;
          var reIsNative = RegExp2(
            "^" + funcToString.call(hasOwnProperty).replace(reRegExpChar, "\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, "$1.*?") + "$"
          );
          var Buffer2 = moduleExports ? context.Buffer : undefined2, Symbol2 = context.Symbol, Uint8Array2 = context.Uint8Array, allocUnsafe = Buffer2 ? Buffer2.allocUnsafe : undefined2, getPrototype = overArg(Object2.getPrototypeOf, Object2), objectCreate = Object2.create, propertyIsEnumerable = objectProto.propertyIsEnumerable, splice = arrayProto.splice, spreadableSymbol = Symbol2 ? Symbol2.isConcatSpreadable : undefined2, symIterator = Symbol2 ? Symbol2.iterator : undefined2, symToStringTag = Symbol2 ? Symbol2.toStringTag : undefined2;
          var defineProperty = function() {
            try {
              var func = getNative(Object2, "defineProperty");
              func({}, "", {});
              return func;
            } catch (e) {
            }
          }();
          var ctxClearTimeout = context.clearTimeout !== root.clearTimeout && context.clearTimeout, ctxNow = Date2 && Date2.now !== root.Date.now && Date2.now, ctxSetTimeout = context.setTimeout !== root.setTimeout && context.setTimeout;
          var nativeCeil = Math2.ceil, nativeFloor = Math2.floor, nativeGetSymbols = Object2.getOwnPropertySymbols, nativeIsBuffer = Buffer2 ? Buffer2.isBuffer : undefined2, nativeIsFinite = context.isFinite, nativeJoin = arrayProto.join, nativeKeys = overArg(Object2.keys, Object2), nativeMax = Math2.max, nativeMin = Math2.min, nativeNow = Date2.now, nativeParseInt = context.parseInt, nativeRandom = Math2.random, nativeReverse = arrayProto.reverse;
          var DataView = getNative(context, "DataView"), Map2 = getNative(context, "Map"), Promise2 = getNative(context, "Promise"), Set2 = getNative(context, "Set"), WeakMap = getNative(context, "WeakMap"), nativeCreate = getNative(Object2, "create");
          var metaMap = WeakMap && new WeakMap();
          var realNames = {};
          var dataViewCtorString = toSource(DataView), mapCtorString = toSource(Map2), promiseCtorString = toSource(Promise2), setCtorString = toSource(Set2), weakMapCtorString = toSource(WeakMap);
          var symbolProto = Symbol2 ? Symbol2.prototype : undefined2, symbolValueOf = symbolProto ? symbolProto.valueOf : undefined2, symbolToString = symbolProto ? symbolProto.toString : undefined2;
          function lodash(value) {
            if (isObjectLike(value) && !isArray(value) && !(value instanceof LazyWrapper)) {
              if (value instanceof LodashWrapper) {
                return value;
              }
              if (hasOwnProperty.call(value, "__wrapped__")) {
                return wrapperClone(value);
              }
            }
            return new LodashWrapper(value);
          }
          var baseCreate = function() {
            function object2() {
            }
            return function(proto) {
              if (!isObject(proto)) {
                return {};
              }
              if (objectCreate) {
                return objectCreate(proto);
              }
              object2.prototype = proto;
              var result4 = new object2();
              object2.prototype = undefined2;
              return result4;
            };
          }();
          function baseLodash() {
          }
          function LodashWrapper(value, chainAll) {
            this.__wrapped__ = value;
            this.__actions__ = [];
            this.__chain__ = !!chainAll;
            this.__index__ = 0;
            this.__values__ = undefined2;
          }
          lodash.templateSettings = {
            /**
             * Used to detect `data` property values to be HTML-escaped.
             *
             * @memberOf _.templateSettings
             * @type {RegExp}
             */
            "escape": reEscape,
            /**
             * Used to detect code to be evaluated.
             *
             * @memberOf _.templateSettings
             * @type {RegExp}
             */
            "evaluate": reEvaluate,
            /**
             * Used to detect `data` property values to inject.
             *
             * @memberOf _.templateSettings
             * @type {RegExp}
             */
            "interpolate": reInterpolate,
            /**
             * Used to reference the data object in the template text.
             *
             * @memberOf _.templateSettings
             * @type {string}
             */
            "variable": "",
            /**
             * Used to import variables into the compiled template.
             *
             * @memberOf _.templateSettings
             * @type {Object}
             */
            "imports": {
              /**
               * A reference to the `lodash` function.
               *
               * @memberOf _.templateSettings.imports
               * @type {Function}
               */
              "_": lodash
            }
          };
          lodash.prototype = baseLodash.prototype;
          lodash.prototype.constructor = lodash;
          LodashWrapper.prototype = baseCreate(baseLodash.prototype);
          LodashWrapper.prototype.constructor = LodashWrapper;
          function LazyWrapper(value) {
            this.__wrapped__ = value;
            this.__actions__ = [];
            this.__dir__ = 1;
            this.__filtered__ = false;
            this.__iteratees__ = [];
            this.__takeCount__ = MAX_ARRAY_LENGTH;
            this.__views__ = [];
          }
          function lazyClone() {
            var result4 = new LazyWrapper(this.__wrapped__);
            result4.__actions__ = copyArray(this.__actions__);
            result4.__dir__ = this.__dir__;
            result4.__filtered__ = this.__filtered__;
            result4.__iteratees__ = copyArray(this.__iteratees__);
            result4.__takeCount__ = this.__takeCount__;
            result4.__views__ = copyArray(this.__views__);
            return result4;
          }
          function lazyReverse() {
            if (this.__filtered__) {
              var result4 = new LazyWrapper(this);
              result4.__dir__ = -1;
              result4.__filtered__ = true;
            } else {
              result4 = this.clone();
              result4.__dir__ *= -1;
            }
            return result4;
          }
          function lazyValue() {
            var array = this.__wrapped__.value(), dir2 = this.__dir__, isArr = isArray(array), isRight = dir2 < 0, arrLength = isArr ? array.length : 0, view = getView(0, arrLength, this.__views__), start2 = view.start, end = view.end, length = end - start2, index = isRight ? end : start2 - 1, iteratees = this.__iteratees__, iterLength = iteratees.length, resIndex = 0, takeCount = nativeMin(length, this.__takeCount__);
            if (!isArr || !isRight && arrLength == length && takeCount == length) {
              return baseWrapperValue(array, this.__actions__);
            }
            var result4 = [];
            outer:
              while (length-- && resIndex < takeCount) {
                index += dir2;
                var iterIndex = -1, value = array[index];
                while (++iterIndex < iterLength) {
                  var data = iteratees[iterIndex], iteratee2 = data.iteratee, type = data.type, computed = iteratee2(value);
                  if (type == LAZY_MAP_FLAG) {
                    value = computed;
                  } else if (!computed) {
                    if (type == LAZY_FILTER_FLAG) {
                      continue outer;
                    } else {
                      break outer;
                    }
                  }
                }
                result4[resIndex++] = value;
              }
            return result4;
          }
          LazyWrapper.prototype = baseCreate(baseLodash.prototype);
          LazyWrapper.prototype.constructor = LazyWrapper;
          function Hash(entries) {
            var index = -1, length = entries == null ? 0 : entries.length;
            this.clear();
            while (++index < length) {
              var entry = entries[index];
              this.set(entry[0], entry[1]);
            }
          }
          function hashClear() {
            this.__data__ = nativeCreate ? nativeCreate(null) : {};
            this.size = 0;
          }
          function hashDelete(key) {
            var result4 = this.has(key) && delete this.__data__[key];
            this.size -= result4 ? 1 : 0;
            return result4;
          }
          function hashGet(key) {
            var data = this.__data__;
            if (nativeCreate) {
              var result4 = data[key];
              return result4 === HASH_UNDEFINED ? undefined2 : result4;
            }
            return hasOwnProperty.call(data, key) ? data[key] : undefined2;
          }
          function hashHas(key) {
            var data = this.__data__;
            return nativeCreate ? data[key] !== undefined2 : hasOwnProperty.call(data, key);
          }
          function hashSet(key, value) {
            var data = this.__data__;
            this.size += this.has(key) ? 0 : 1;
            data[key] = nativeCreate && value === undefined2 ? HASH_UNDEFINED : value;
            return this;
          }
          Hash.prototype.clear = hashClear;
          Hash.prototype["delete"] = hashDelete;
          Hash.prototype.get = hashGet;
          Hash.prototype.has = hashHas;
          Hash.prototype.set = hashSet;
          function ListCache(entries) {
            var index = -1, length = entries == null ? 0 : entries.length;
            this.clear();
            while (++index < length) {
              var entry = entries[index];
              this.set(entry[0], entry[1]);
            }
          }
          function listCacheClear() {
            this.__data__ = [];
            this.size = 0;
          }
          function listCacheDelete(key) {
            var data = this.__data__, index = assocIndexOf(data, key);
            if (index < 0) {
              return false;
            }
            var lastIndex = data.length - 1;
            if (index == lastIndex) {
              data.pop();
            } else {
              splice.call(data, index, 1);
            }
            --this.size;
            return true;
          }
          function listCacheGet(key) {
            var data = this.__data__, index = assocIndexOf(data, key);
            return index < 0 ? undefined2 : data[index][1];
          }
          function listCacheHas(key) {
            return assocIndexOf(this.__data__, key) > -1;
          }
          function listCacheSet(key, value) {
            var data = this.__data__, index = assocIndexOf(data, key);
            if (index < 0) {
              ++this.size;
              data.push([key, value]);
            } else {
              data[index][1] = value;
            }
            return this;
          }
          ListCache.prototype.clear = listCacheClear;
          ListCache.prototype["delete"] = listCacheDelete;
          ListCache.prototype.get = listCacheGet;
          ListCache.prototype.has = listCacheHas;
          ListCache.prototype.set = listCacheSet;
          function MapCache(entries) {
            var index = -1, length = entries == null ? 0 : entries.length;
            this.clear();
            while (++index < length) {
              var entry = entries[index];
              this.set(entry[0], entry[1]);
            }
          }
          function mapCacheClear() {
            this.size = 0;
            this.__data__ = {
              "hash": new Hash(),
              "map": new (Map2 || ListCache)(),
              "string": new Hash()
            };
          }
          function mapCacheDelete(key) {
            var result4 = getMapData(this, key)["delete"](key);
            this.size -= result4 ? 1 : 0;
            return result4;
          }
          function mapCacheGet(key) {
            return getMapData(this, key).get(key);
          }
          function mapCacheHas(key) {
            return getMapData(this, key).has(key);
          }
          function mapCacheSet(key, value) {
            var data = getMapData(this, key), size2 = data.size;
            data.set(key, value);
            this.size += data.size == size2 ? 0 : 1;
            return this;
          }
          MapCache.prototype.clear = mapCacheClear;
          MapCache.prototype["delete"] = mapCacheDelete;
          MapCache.prototype.get = mapCacheGet;
          MapCache.prototype.has = mapCacheHas;
          MapCache.prototype.set = mapCacheSet;
          function SetCache(values2) {
            var index = -1, length = values2 == null ? 0 : values2.length;
            this.__data__ = new MapCache();
            while (++index < length) {
              this.add(values2[index]);
            }
          }
          function setCacheAdd(value) {
            this.__data__.set(value, HASH_UNDEFINED);
            return this;
          }
          function setCacheHas(value) {
            return this.__data__.has(value);
          }
          SetCache.prototype.add = SetCache.prototype.push = setCacheAdd;
          SetCache.prototype.has = setCacheHas;
          function Stack(entries) {
            var data = this.__data__ = new ListCache(entries);
            this.size = data.size;
          }
          function stackClear() {
            this.__data__ = new ListCache();
            this.size = 0;
          }
          function stackDelete(key) {
            var data = this.__data__, result4 = data["delete"](key);
            this.size = data.size;
            return result4;
          }
          function stackGet(key) {
            return this.__data__.get(key);
          }
          function stackHas(key) {
            return this.__data__.has(key);
          }
          function stackSet(key, value) {
            var data = this.__data__;
            if (data instanceof ListCache) {
              var pairs = data.__data__;
              if (!Map2 || pairs.length < LARGE_ARRAY_SIZE - 1) {
                pairs.push([key, value]);
                this.size = ++data.size;
                return this;
              }
              data = this.__data__ = new MapCache(pairs);
            }
            data.set(key, value);
            this.size = data.size;
            return this;
          }
          Stack.prototype.clear = stackClear;
          Stack.prototype["delete"] = stackDelete;
          Stack.prototype.get = stackGet;
          Stack.prototype.has = stackHas;
          Stack.prototype.set = stackSet;
          function arrayLikeKeys(value, inherited) {
            var isArr = isArray(value), isArg = !isArr && isArguments(value), isBuff = !isArr && !isArg && isBuffer(value), isType = !isArr && !isArg && !isBuff && isTypedArray(value), skipIndexes = isArr || isArg || isBuff || isType, result4 = skipIndexes ? baseTimes(value.length, String2) : [], length = result4.length;
            for (var key in value) {
              if ((inherited || hasOwnProperty.call(value, key)) && !(skipIndexes && // Safari 9 has enumerable `arguments.length` in strict mode.
              (key == "length" || // Node.js 0.10 has enumerable non-index properties on buffers.
              isBuff && (key == "offset" || key == "parent") || // PhantomJS 2 has enumerable non-index properties on typed arrays.
              isType && (key == "buffer" || key == "byteLength" || key == "byteOffset") || // Skip index properties.
              isIndex(key, length)))) {
                result4.push(key);
              }
            }
            return result4;
          }
          function arraySample(array) {
            var length = array.length;
            return length ? array[baseRandom(0, length - 1)] : undefined2;
          }
          function arraySampleSize(array, n) {
            return shuffleSelf(copyArray(array), baseClamp(n, 0, array.length));
          }
          function arrayShuffle(array) {
            return shuffleSelf(copyArray(array));
          }
          function assignMergeValue(object2, key, value) {
            if (value !== undefined2 && !eq(object2[key], value) || value === undefined2 && !(key in object2)) {
              baseAssignValue(object2, key, value);
            }
          }
          function assignValue(object2, key, value) {
            var objValue = object2[key];
            if (!(hasOwnProperty.call(object2, key) && eq(objValue, value)) || value === undefined2 && !(key in object2)) {
              baseAssignValue(object2, key, value);
            }
          }
          function assocIndexOf(array, key) {
            var length = array.length;
            while (length--) {
              if (eq(array[length][0], key)) {
                return length;
              }
            }
            return -1;
          }
          function baseAggregator(collection, setter, iteratee2, accumulator) {
            baseEach(collection, function(value, key, collection2) {
              setter(accumulator, value, iteratee2(value), collection2);
            });
            return accumulator;
          }
          function baseAssign(object2, source) {
            return object2 && copyObject(source, keys(source), object2);
          }
          function baseAssignIn(object2, source) {
            return object2 && copyObject(source, keysIn(source), object2);
          }
          function baseAssignValue(object2, key, value) {
            if (key == "__proto__" && defineProperty) {
              defineProperty(object2, key, {
                "configurable": true,
                "enumerable": true,
                "value": value,
                "writable": true
              });
            } else {
              object2[key] = value;
            }
          }
          function baseAt(object2, paths) {
            var index = -1, length = paths.length, result4 = Array2(length), skip = object2 == null;
            while (++index < length) {
              result4[index] = skip ? undefined2 : get2(object2, paths[index]);
            }
            return result4;
          }
          function baseClamp(number, lower, upper) {
            if (number === number) {
              if (upper !== undefined2) {
                number = number <= upper ? number : upper;
              }
              if (lower !== undefined2) {
                number = number >= lower ? number : lower;
              }
            }
            return number;
          }
          function baseClone(value, bitmask, customizer, key, object2, stack) {
            var result4, isDeep = bitmask & CLONE_DEEP_FLAG, isFlat = bitmask & CLONE_FLAT_FLAG, isFull = bitmask & CLONE_SYMBOLS_FLAG;
            if (customizer) {
              result4 = object2 ? customizer(value, key, object2, stack) : customizer(value);
            }
            if (result4 !== undefined2) {
              return result4;
            }
            if (!isObject(value)) {
              return value;
            }
            var isArr = isArray(value);
            if (isArr) {
              result4 = initCloneArray(value);
              if (!isDeep) {
                return copyArray(value, result4);
              }
            } else {
              var tag = getTag(value), isFunc = tag == funcTag || tag == genTag;
              if (isBuffer(value)) {
                return cloneBuffer(value, isDeep);
              }
              if (tag == objectTag || tag == argsTag || isFunc && !object2) {
                result4 = isFlat || isFunc ? {} : initCloneObject(value);
                if (!isDeep) {
                  return isFlat ? copySymbolsIn(value, baseAssignIn(result4, value)) : copySymbols(value, baseAssign(result4, value));
                }
              } else {
                if (!cloneableTags[tag]) {
                  return object2 ? value : {};
                }
                result4 = initCloneByTag(value, tag, isDeep);
              }
            }
            stack || (stack = new Stack());
            var stacked = stack.get(value);
            if (stacked) {
              return stacked;
            }
            stack.set(value, result4);
            if (isSet(value)) {
              value.forEach(function(subValue) {
                result4.add(baseClone(subValue, bitmask, customizer, subValue, value, stack));
              });
            } else if (isMap(value)) {
              value.forEach(function(subValue, key2) {
                result4.set(key2, baseClone(subValue, bitmask, customizer, key2, value, stack));
              });
            }
            var keysFunc = isFull ? isFlat ? getAllKeysIn : getAllKeys : isFlat ? keysIn : keys;
            var props = isArr ? undefined2 : keysFunc(value);
            arrayEach(props || value, function(subValue, key2) {
              if (props) {
                key2 = subValue;
                subValue = value[key2];
              }
              assignValue(result4, key2, baseClone(subValue, bitmask, customizer, key2, value, stack));
            });
            return result4;
          }
          function baseConforms(source) {
            var props = keys(source);
            return function(object2) {
              return baseConformsTo(object2, source, props);
            };
          }
          function baseConformsTo(object2, source, props) {
            var length = props.length;
            if (object2 == null) {
              return !length;
            }
            object2 = Object2(object2);
            while (length--) {
              var key = props[length], predicate = source[key], value = object2[key];
              if (value === undefined2 && !(key in object2) || !predicate(value)) {
                return false;
              }
            }
            return true;
          }
          function baseDelay(func, wait, args) {
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            return setTimeout2(function() {
              func.apply(undefined2, args);
            }, wait);
          }
          function baseDifference(array, values2, iteratee2, comparator) {
            var index = -1, includes2 = arrayIncludes, isCommon = true, length = array.length, result4 = [], valuesLength = values2.length;
            if (!length) {
              return result4;
            }
            if (iteratee2) {
              values2 = arrayMap(values2, baseUnary(iteratee2));
            }
            if (comparator) {
              includes2 = arrayIncludesWith;
              isCommon = false;
            } else if (values2.length >= LARGE_ARRAY_SIZE) {
              includes2 = cacheHas;
              isCommon = false;
              values2 = new SetCache(values2);
            }
            outer:
              while (++index < length) {
                var value = array[index], computed = iteratee2 == null ? value : iteratee2(value);
                value = comparator || value !== 0 ? value : 0;
                if (isCommon && computed === computed) {
                  var valuesIndex = valuesLength;
                  while (valuesIndex--) {
                    if (values2[valuesIndex] === computed) {
                      continue outer;
                    }
                  }
                  result4.push(value);
                } else if (!includes2(values2, computed, comparator)) {
                  result4.push(value);
                }
              }
            return result4;
          }
          var baseEach = createBaseEach(baseForOwn);
          var baseEachRight = createBaseEach(baseForOwnRight, true);
          function baseEvery(collection, predicate) {
            var result4 = true;
            baseEach(collection, function(value, index, collection2) {
              result4 = !!predicate(value, index, collection2);
              return result4;
            });
            return result4;
          }
          function baseExtremum(array, iteratee2, comparator) {
            var index = -1, length = array.length;
            while (++index < length) {
              var value = array[index], current = iteratee2(value);
              if (current != null && (computed === undefined2 ? current === current && !isSymbol(current) : comparator(current, computed))) {
                var computed = current, result4 = value;
              }
            }
            return result4;
          }
          function baseFill(array, value, start2, end) {
            var length = array.length;
            start2 = toInteger(start2);
            if (start2 < 0) {
              start2 = -start2 > length ? 0 : length + start2;
            }
            end = end === undefined2 || end > length ? length : toInteger(end);
            if (end < 0) {
              end += length;
            }
            end = start2 > end ? 0 : toLength(end);
            while (start2 < end) {
              array[start2++] = value;
            }
            return array;
          }
          function baseFilter(collection, predicate) {
            var result4 = [];
            baseEach(collection, function(value, index, collection2) {
              if (predicate(value, index, collection2)) {
                result4.push(value);
              }
            });
            return result4;
          }
          function baseFlatten(array, depth, predicate, isStrict, result4) {
            var index = -1, length = array.length;
            predicate || (predicate = isFlattenable);
            result4 || (result4 = []);
            while (++index < length) {
              var value = array[index];
              if (depth > 0 && predicate(value)) {
                if (depth > 1) {
                  baseFlatten(value, depth - 1, predicate, isStrict, result4);
                } else {
                  arrayPush(result4, value);
                }
              } else if (!isStrict) {
                result4[result4.length] = value;
              }
            }
            return result4;
          }
          var baseFor = createBaseFor();
          var baseForRight = createBaseFor(true);
          function baseForOwn(object2, iteratee2) {
            return object2 && baseFor(object2, iteratee2, keys);
          }
          function baseForOwnRight(object2, iteratee2) {
            return object2 && baseForRight(object2, iteratee2, keys);
          }
          function baseFunctions(object2, props) {
            return arrayFilter(props, function(key) {
              return isFunction(object2[key]);
            });
          }
          function baseGet(object2, path) {
            path = castPath(path, object2);
            var index = 0, length = path.length;
            while (object2 != null && index < length) {
              object2 = object2[toKey(path[index++])];
            }
            return index && index == length ? object2 : undefined2;
          }
          function baseGetAllKeys(object2, keysFunc, symbolsFunc) {
            var result4 = keysFunc(object2);
            return isArray(object2) ? result4 : arrayPush(result4, symbolsFunc(object2));
          }
          function baseGetTag(value) {
            if (value == null) {
              return value === undefined2 ? undefinedTag : nullTag;
            }
            return symToStringTag && symToStringTag in Object2(value) ? getRawTag(value) : objectToString(value);
          }
          function baseGt(value, other) {
            return value > other;
          }
          function baseHas(object2, key) {
            return object2 != null && hasOwnProperty.call(object2, key);
          }
          function baseHasIn(object2, key) {
            return object2 != null && key in Object2(object2);
          }
          function baseInRange(number, start2, end) {
            return number >= nativeMin(start2, end) && number < nativeMax(start2, end);
          }
          function baseIntersection(arrays, iteratee2, comparator) {
            var includes2 = comparator ? arrayIncludesWith : arrayIncludes, length = arrays[0].length, othLength = arrays.length, othIndex = othLength, caches = Array2(othLength), maxLength = Infinity, result4 = [];
            while (othIndex--) {
              var array = arrays[othIndex];
              if (othIndex && iteratee2) {
                array = arrayMap(array, baseUnary(iteratee2));
              }
              maxLength = nativeMin(array.length, maxLength);
              caches[othIndex] = !comparator && (iteratee2 || length >= 120 && array.length >= 120) ? new SetCache(othIndex && array) : undefined2;
            }
            array = arrays[0];
            var index = -1, seen = caches[0];
            outer:
              while (++index < length && result4.length < maxLength) {
                var value = array[index], computed = iteratee2 ? iteratee2(value) : value;
                value = comparator || value !== 0 ? value : 0;
                if (!(seen ? cacheHas(seen, computed) : includes2(result4, computed, comparator))) {
                  othIndex = othLength;
                  while (--othIndex) {
                    var cache = caches[othIndex];
                    if (!(cache ? cacheHas(cache, computed) : includes2(arrays[othIndex], computed, comparator))) {
                      continue outer;
                    }
                  }
                  if (seen) {
                    seen.push(computed);
                  }
                  result4.push(value);
                }
              }
            return result4;
          }
          function baseInverter(object2, setter, iteratee2, accumulator) {
            baseForOwn(object2, function(value, key, object3) {
              setter(accumulator, iteratee2(value), key, object3);
            });
            return accumulator;
          }
          function baseInvoke(object2, path, args) {
            path = castPath(path, object2);
            object2 = parent(object2, path);
            var func = object2 == null ? object2 : object2[toKey(last(path))];
            return func == null ? undefined2 : apply(func, object2, args);
          }
          function baseIsArguments(value) {
            return isObjectLike(value) && baseGetTag(value) == argsTag;
          }
          function baseIsArrayBuffer(value) {
            return isObjectLike(value) && baseGetTag(value) == arrayBufferTag;
          }
          function baseIsDate(value) {
            return isObjectLike(value) && baseGetTag(value) == dateTag;
          }
          function baseIsEqual(value, other, bitmask, customizer, stack) {
            if (value === other) {
              return true;
            }
            if (value == null || other == null || !isObjectLike(value) && !isObjectLike(other)) {
              return value !== value && other !== other;
            }
            return baseIsEqualDeep(value, other, bitmask, customizer, baseIsEqual, stack);
          }
          function baseIsEqualDeep(object2, other, bitmask, customizer, equalFunc, stack) {
            var objIsArr = isArray(object2), othIsArr = isArray(other), objTag = objIsArr ? arrayTag : getTag(object2), othTag = othIsArr ? arrayTag : getTag(other);
            objTag = objTag == argsTag ? objectTag : objTag;
            othTag = othTag == argsTag ? objectTag : othTag;
            var objIsObj = objTag == objectTag, othIsObj = othTag == objectTag, isSameTag = objTag == othTag;
            if (isSameTag && isBuffer(object2)) {
              if (!isBuffer(other)) {
                return false;
              }
              objIsArr = true;
              objIsObj = false;
            }
            if (isSameTag && !objIsObj) {
              stack || (stack = new Stack());
              return objIsArr || isTypedArray(object2) ? equalArrays(object2, other, bitmask, customizer, equalFunc, stack) : equalByTag(object2, other, objTag, bitmask, customizer, equalFunc, stack);
            }
            if (!(bitmask & COMPARE_PARTIAL_FLAG)) {
              var objIsWrapped = objIsObj && hasOwnProperty.call(object2, "__wrapped__"), othIsWrapped = othIsObj && hasOwnProperty.call(other, "__wrapped__");
              if (objIsWrapped || othIsWrapped) {
                var objUnwrapped = objIsWrapped ? object2.value() : object2, othUnwrapped = othIsWrapped ? other.value() : other;
                stack || (stack = new Stack());
                return equalFunc(objUnwrapped, othUnwrapped, bitmask, customizer, stack);
              }
            }
            if (!isSameTag) {
              return false;
            }
            stack || (stack = new Stack());
            return equalObjects(object2, other, bitmask, customizer, equalFunc, stack);
          }
          function baseIsMap(value) {
            return isObjectLike(value) && getTag(value) == mapTag;
          }
          function baseIsMatch(object2, source, matchData, customizer) {
            var index = matchData.length, length = index, noCustomizer = !customizer;
            if (object2 == null) {
              return !length;
            }
            object2 = Object2(object2);
            while (index--) {
              var data = matchData[index];
              if (noCustomizer && data[2] ? data[1] !== object2[data[0]] : !(data[0] in object2)) {
                return false;
              }
            }
            while (++index < length) {
              data = matchData[index];
              var key = data[0], objValue = object2[key], srcValue = data[1];
              if (noCustomizer && data[2]) {
                if (objValue === undefined2 && !(key in object2)) {
                  return false;
                }
              } else {
                var stack = new Stack();
                if (customizer) {
                  var result4 = customizer(objValue, srcValue, key, object2, source, stack);
                }
                if (!(result4 === undefined2 ? baseIsEqual(srcValue, objValue, COMPARE_PARTIAL_FLAG | COMPARE_UNORDERED_FLAG, customizer, stack) : result4)) {
                  return false;
                }
              }
            }
            return true;
          }
          function baseIsNative(value) {
            if (!isObject(value) || isMasked(value)) {
              return false;
            }
            var pattern = isFunction(value) ? reIsNative : reIsHostCtor;
            return pattern.test(toSource(value));
          }
          function baseIsRegExp(value) {
            return isObjectLike(value) && baseGetTag(value) == regexpTag;
          }
          function baseIsSet(value) {
            return isObjectLike(value) && getTag(value) == setTag;
          }
          function baseIsTypedArray(value) {
            return isObjectLike(value) && isLength(value.length) && !!typedArrayTags[baseGetTag(value)];
          }
          function baseIteratee(value) {
            if (typeof value == "function") {
              return value;
            }
            if (value == null) {
              return identity;
            }
            if (typeof value == "object") {
              return isArray(value) ? baseMatchesProperty(value[0], value[1]) : baseMatches(value);
            }
            return property(value);
          }
          function baseKeys(object2) {
            if (!isPrototype(object2)) {
              return nativeKeys(object2);
            }
            var result4 = [];
            for (var key in Object2(object2)) {
              if (hasOwnProperty.call(object2, key) && key != "constructor") {
                result4.push(key);
              }
            }
            return result4;
          }
          function baseKeysIn(object2) {
            if (!isObject(object2)) {
              return nativeKeysIn(object2);
            }
            var isProto = isPrototype(object2), result4 = [];
            for (var key in object2) {
              if (!(key == "constructor" && (isProto || !hasOwnProperty.call(object2, key)))) {
                result4.push(key);
              }
            }
            return result4;
          }
          function baseLt(value, other) {
            return value < other;
          }
          function baseMap(collection, iteratee2) {
            var index = -1, result4 = isArrayLike(collection) ? Array2(collection.length) : [];
            baseEach(collection, function(value, key, collection2) {
              result4[++index] = iteratee2(value, key, collection2);
            });
            return result4;
          }
          function baseMatches(source) {
            var matchData = getMatchData(source);
            if (matchData.length == 1 && matchData[0][2]) {
              return matchesStrictComparable(matchData[0][0], matchData[0][1]);
            }
            return function(object2) {
              return object2 === source || baseIsMatch(object2, source, matchData);
            };
          }
          function baseMatchesProperty(path, srcValue) {
            if (isKey(path) && isStrictComparable(srcValue)) {
              return matchesStrictComparable(toKey(path), srcValue);
            }
            return function(object2) {
              var objValue = get2(object2, path);
              return objValue === undefined2 && objValue === srcValue ? hasIn(object2, path) : baseIsEqual(srcValue, objValue, COMPARE_PARTIAL_FLAG | COMPARE_UNORDERED_FLAG);
            };
          }
          function baseMerge(object2, source, srcIndex, customizer, stack) {
            if (object2 === source) {
              return;
            }
            baseFor(source, function(srcValue, key) {
              stack || (stack = new Stack());
              if (isObject(srcValue)) {
                baseMergeDeep(object2, source, key, srcIndex, baseMerge, customizer, stack);
              } else {
                var newValue = customizer ? customizer(safeGet(object2, key), srcValue, key + "", object2, source, stack) : undefined2;
                if (newValue === undefined2) {
                  newValue = srcValue;
                }
                assignMergeValue(object2, key, newValue);
              }
            }, keysIn);
          }
          function baseMergeDeep(object2, source, key, srcIndex, mergeFunc, customizer, stack) {
            var objValue = safeGet(object2, key), srcValue = safeGet(source, key), stacked = stack.get(srcValue);
            if (stacked) {
              assignMergeValue(object2, key, stacked);
              return;
            }
            var newValue = customizer ? customizer(objValue, srcValue, key + "", object2, source, stack) : undefined2;
            var isCommon = newValue === undefined2;
            if (isCommon) {
              var isArr = isArray(srcValue), isBuff = !isArr && isBuffer(srcValue), isTyped = !isArr && !isBuff && isTypedArray(srcValue);
              newValue = srcValue;
              if (isArr || isBuff || isTyped) {
                if (isArray(objValue)) {
                  newValue = objValue;
                } else if (isArrayLikeObject(objValue)) {
                  newValue = copyArray(objValue);
                } else if (isBuff) {
                  isCommon = false;
                  newValue = cloneBuffer(srcValue, true);
                } else if (isTyped) {
                  isCommon = false;
                  newValue = cloneTypedArray(srcValue, true);
                } else {
                  newValue = [];
                }
              } else if (isPlainObject(srcValue) || isArguments(srcValue)) {
                newValue = objValue;
                if (isArguments(objValue)) {
                  newValue = toPlainObject(objValue);
                } else if (!isObject(objValue) || isFunction(objValue)) {
                  newValue = initCloneObject(srcValue);
                }
              } else {
                isCommon = false;
              }
            }
            if (isCommon) {
              stack.set(srcValue, newValue);
              mergeFunc(newValue, srcValue, srcIndex, customizer, stack);
              stack["delete"](srcValue);
            }
            assignMergeValue(object2, key, newValue);
          }
          function baseNth(array, n) {
            var length = array.length;
            if (!length) {
              return;
            }
            n += n < 0 ? length : 0;
            return isIndex(n, length) ? array[n] : undefined2;
          }
          function baseOrderBy(collection, iteratees, orders) {
            if (iteratees.length) {
              iteratees = arrayMap(iteratees, function(iteratee2) {
                if (isArray(iteratee2)) {
                  return function(value) {
                    return baseGet(value, iteratee2.length === 1 ? iteratee2[0] : iteratee2);
                  };
                }
                return iteratee2;
              });
            } else {
              iteratees = [identity];
            }
            var index = -1;
            iteratees = arrayMap(iteratees, baseUnary(getIteratee()));
            var result4 = baseMap(collection, function(value, key, collection2) {
              var criteria = arrayMap(iteratees, function(iteratee2) {
                return iteratee2(value);
              });
              return { "criteria": criteria, "index": ++index, "value": value };
            });
            return baseSortBy(result4, function(object2, other) {
              return compareMultiple(object2, other, orders);
            });
          }
          function basePick(object2, paths) {
            return basePickBy(object2, paths, function(value, path) {
              return hasIn(object2, path);
            });
          }
          function basePickBy(object2, paths, predicate) {
            var index = -1, length = paths.length, result4 = {};
            while (++index < length) {
              var path = paths[index], value = baseGet(object2, path);
              if (predicate(value, path)) {
                baseSet(result4, castPath(path, object2), value);
              }
            }
            return result4;
          }
          function basePropertyDeep(path) {
            return function(object2) {
              return baseGet(object2, path);
            };
          }
          function basePullAll(array, values2, iteratee2, comparator) {
            var indexOf2 = comparator ? baseIndexOfWith : baseIndexOf, index = -1, length = values2.length, seen = array;
            if (array === values2) {
              values2 = copyArray(values2);
            }
            if (iteratee2) {
              seen = arrayMap(array, baseUnary(iteratee2));
            }
            while (++index < length) {
              var fromIndex = 0, value = values2[index], computed = iteratee2 ? iteratee2(value) : value;
              while ((fromIndex = indexOf2(seen, computed, fromIndex, comparator)) > -1) {
                if (seen !== array) {
                  splice.call(seen, fromIndex, 1);
                }
                splice.call(array, fromIndex, 1);
              }
            }
            return array;
          }
          function basePullAt(array, indexes) {
            var length = array ? indexes.length : 0, lastIndex = length - 1;
            while (length--) {
              var index = indexes[length];
              if (length == lastIndex || index !== previous) {
                var previous = index;
                if (isIndex(index)) {
                  splice.call(array, index, 1);
                } else {
                  baseUnset(array, index);
                }
              }
            }
            return array;
          }
          function baseRandom(lower, upper) {
            return lower + nativeFloor(nativeRandom() * (upper - lower + 1));
          }
          function baseRange(start2, end, step, fromRight) {
            var index = -1, length = nativeMax(nativeCeil((end - start2) / (step || 1)), 0), result4 = Array2(length);
            while (length--) {
              result4[fromRight ? length : ++index] = start2;
              start2 += step;
            }
            return result4;
          }
          function baseRepeat(string, n) {
            var result4 = "";
            if (!string || n < 1 || n > MAX_SAFE_INTEGER) {
              return result4;
            }
            do {
              if (n % 2) {
                result4 += string;
              }
              n = nativeFloor(n / 2);
              if (n) {
                string += string;
              }
            } while (n);
            return result4;
          }
          function baseRest(func, start2) {
            return setToString(overRest(func, start2, identity), func + "");
          }
          function baseSample(collection) {
            return arraySample(values(collection));
          }
          function baseSampleSize(collection, n) {
            var array = values(collection);
            return shuffleSelf(array, baseClamp(n, 0, array.length));
          }
          function baseSet(object2, path, value, customizer) {
            if (!isObject(object2)) {
              return object2;
            }
            path = castPath(path, object2);
            var index = -1, length = path.length, lastIndex = length - 1, nested = object2;
            while (nested != null && ++index < length) {
              var key = toKey(path[index]), newValue = value;
              if (key === "__proto__" || key === "constructor" || key === "prototype") {
                return object2;
              }
              if (index != lastIndex) {
                var objValue = nested[key];
                newValue = customizer ? customizer(objValue, key, nested) : undefined2;
                if (newValue === undefined2) {
                  newValue = isObject(objValue) ? objValue : isIndex(path[index + 1]) ? [] : {};
                }
              }
              assignValue(nested, key, newValue);
              nested = nested[key];
            }
            return object2;
          }
          var baseSetData = !metaMap ? identity : function(func, data) {
            metaMap.set(func, data);
            return func;
          };
          var baseSetToString = !defineProperty ? identity : function(func, string) {
            return defineProperty(func, "toString", {
              "configurable": true,
              "enumerable": false,
              "value": constant(string),
              "writable": true
            });
          };
          function baseShuffle(collection) {
            return shuffleSelf(values(collection));
          }
          function baseSlice(array, start2, end) {
            var index = -1, length = array.length;
            if (start2 < 0) {
              start2 = -start2 > length ? 0 : length + start2;
            }
            end = end > length ? length : end;
            if (end < 0) {
              end += length;
            }
            length = start2 > end ? 0 : end - start2 >>> 0;
            start2 >>>= 0;
            var result4 = Array2(length);
            while (++index < length) {
              result4[index] = array[index + start2];
            }
            return result4;
          }
          function baseSome(collection, predicate) {
            var result4;
            baseEach(collection, function(value, index, collection2) {
              result4 = predicate(value, index, collection2);
              return !result4;
            });
            return !!result4;
          }
          function baseSortedIndex(array, value, retHighest) {
            var low = 0, high = array == null ? low : array.length;
            if (typeof value == "number" && value === value && high <= HALF_MAX_ARRAY_LENGTH) {
              while (low < high) {
                var mid = low + high >>> 1, computed = array[mid];
                if (computed !== null && !isSymbol(computed) && (retHighest ? computed <= value : computed < value)) {
                  low = mid + 1;
                } else {
                  high = mid;
                }
              }
              return high;
            }
            return baseSortedIndexBy(array, value, identity, retHighest);
          }
          function baseSortedIndexBy(array, value, iteratee2, retHighest) {
            var low = 0, high = array == null ? 0 : array.length;
            if (high === 0) {
              return 0;
            }
            value = iteratee2(value);
            var valIsNaN = value !== value, valIsNull = value === null, valIsSymbol = isSymbol(value), valIsUndefined = value === undefined2;
            while (low < high) {
              var mid = nativeFloor((low + high) / 2), computed = iteratee2(array[mid]), othIsDefined = computed !== undefined2, othIsNull = computed === null, othIsReflexive = computed === computed, othIsSymbol = isSymbol(computed);
              if (valIsNaN) {
                var setLow = retHighest || othIsReflexive;
              } else if (valIsUndefined) {
                setLow = othIsReflexive && (retHighest || othIsDefined);
              } else if (valIsNull) {
                setLow = othIsReflexive && othIsDefined && (retHighest || !othIsNull);
              } else if (valIsSymbol) {
                setLow = othIsReflexive && othIsDefined && !othIsNull && (retHighest || !othIsSymbol);
              } else if (othIsNull || othIsSymbol) {
                setLow = false;
              } else {
                setLow = retHighest ? computed <= value : computed < value;
              }
              if (setLow) {
                low = mid + 1;
              } else {
                high = mid;
              }
            }
            return nativeMin(high, MAX_ARRAY_INDEX);
          }
          function baseSortedUniq(array, iteratee2) {
            var index = -1, length = array.length, resIndex = 0, result4 = [];
            while (++index < length) {
              var value = array[index], computed = iteratee2 ? iteratee2(value) : value;
              if (!index || !eq(computed, seen)) {
                var seen = computed;
                result4[resIndex++] = value === 0 ? 0 : value;
              }
            }
            return result4;
          }
          function baseToNumber(value) {
            if (typeof value == "number") {
              return value;
            }
            if (isSymbol(value)) {
              return NAN;
            }
            return +value;
          }
          function baseToString(value) {
            if (typeof value == "string") {
              return value;
            }
            if (isArray(value)) {
              return arrayMap(value, baseToString) + "";
            }
            if (isSymbol(value)) {
              return symbolToString ? symbolToString.call(value) : "";
            }
            var result4 = value + "";
            return result4 == "0" && 1 / value == -INFINITY ? "-0" : result4;
          }
          function baseUniq(array, iteratee2, comparator) {
            var index = -1, includes2 = arrayIncludes, length = array.length, isCommon = true, result4 = [], seen = result4;
            if (comparator) {
              isCommon = false;
              includes2 = arrayIncludesWith;
            } else if (length >= LARGE_ARRAY_SIZE) {
              var set2 = iteratee2 ? null : createSet(array);
              if (set2) {
                return setToArray(set2);
              }
              isCommon = false;
              includes2 = cacheHas;
              seen = new SetCache();
            } else {
              seen = iteratee2 ? [] : result4;
            }
            outer:
              while (++index < length) {
                var value = array[index], computed = iteratee2 ? iteratee2(value) : value;
                value = comparator || value !== 0 ? value : 0;
                if (isCommon && computed === computed) {
                  var seenIndex = seen.length;
                  while (seenIndex--) {
                    if (seen[seenIndex] === computed) {
                      continue outer;
                    }
                  }
                  if (iteratee2) {
                    seen.push(computed);
                  }
                  result4.push(value);
                } else if (!includes2(seen, computed, comparator)) {
                  if (seen !== result4) {
                    seen.push(computed);
                  }
                  result4.push(value);
                }
              }
            return result4;
          }
          function baseUnset(object2, path) {
            path = castPath(path, object2);
            object2 = parent(object2, path);
            return object2 == null || delete object2[toKey(last(path))];
          }
          function baseUpdate(object2, path, updater, customizer) {
            return baseSet(object2, path, updater(baseGet(object2, path)), customizer);
          }
          function baseWhile(array, predicate, isDrop, fromRight) {
            var length = array.length, index = fromRight ? length : -1;
            while ((fromRight ? index-- : ++index < length) && predicate(array[index], index, array)) {
            }
            return isDrop ? baseSlice(array, fromRight ? 0 : index, fromRight ? index + 1 : length) : baseSlice(array, fromRight ? index + 1 : 0, fromRight ? length : index);
          }
          function baseWrapperValue(value, actions) {
            var result4 = value;
            if (result4 instanceof LazyWrapper) {
              result4 = result4.value();
            }
            return arrayReduce(actions, function(result5, action) {
              return action.func.apply(action.thisArg, arrayPush([result5], action.args));
            }, result4);
          }
          function baseXor(arrays, iteratee2, comparator) {
            var length = arrays.length;
            if (length < 2) {
              return length ? baseUniq(arrays[0]) : [];
            }
            var index = -1, result4 = Array2(length);
            while (++index < length) {
              var array = arrays[index], othIndex = -1;
              while (++othIndex < length) {
                if (othIndex != index) {
                  result4[index] = baseDifference(result4[index] || array, arrays[othIndex], iteratee2, comparator);
                }
              }
            }
            return baseUniq(baseFlatten(result4, 1), iteratee2, comparator);
          }
          function baseZipObject(props, values2, assignFunc) {
            var index = -1, length = props.length, valsLength = values2.length, result4 = {};
            while (++index < length) {
              var value = index < valsLength ? values2[index] : undefined2;
              assignFunc(result4, props[index], value);
            }
            return result4;
          }
          function castArrayLikeObject(value) {
            return isArrayLikeObject(value) ? value : [];
          }
          function castFunction(value) {
            return typeof value == "function" ? value : identity;
          }
          function castPath(value, object2) {
            if (isArray(value)) {
              return value;
            }
            return isKey(value, object2) ? [value] : stringToPath(toString(value));
          }
          var castRest = baseRest;
          function castSlice(array, start2, end) {
            var length = array.length;
            end = end === undefined2 ? length : end;
            return !start2 && end >= length ? array : baseSlice(array, start2, end);
          }
          var clearTimeout2 = ctxClearTimeout || function(id) {
            return root.clearTimeout(id);
          };
          function cloneBuffer(buffer, isDeep) {
            if (isDeep) {
              return buffer.slice();
            }
            var length = buffer.length, result4 = allocUnsafe ? allocUnsafe(length) : new buffer.constructor(length);
            buffer.copy(result4);
            return result4;
          }
          function cloneArrayBuffer(arrayBuffer) {
            var result4 = new arrayBuffer.constructor(arrayBuffer.byteLength);
            new Uint8Array2(result4).set(new Uint8Array2(arrayBuffer));
            return result4;
          }
          function cloneDataView(dataView, isDeep) {
            var buffer = isDeep ? cloneArrayBuffer(dataView.buffer) : dataView.buffer;
            return new dataView.constructor(buffer, dataView.byteOffset, dataView.byteLength);
          }
          function cloneRegExp(regexp) {
            var result4 = new regexp.constructor(regexp.source, reFlags.exec(regexp));
            result4.lastIndex = regexp.lastIndex;
            return result4;
          }
          function cloneSymbol(symbol) {
            return symbolValueOf ? Object2(symbolValueOf.call(symbol)) : {};
          }
          function cloneTypedArray(typedArray, isDeep) {
            var buffer = isDeep ? cloneArrayBuffer(typedArray.buffer) : typedArray.buffer;
            return new typedArray.constructor(buffer, typedArray.byteOffset, typedArray.length);
          }
          function compareAscending(value, other) {
            if (value !== other) {
              var valIsDefined = value !== undefined2, valIsNull = value === null, valIsReflexive = value === value, valIsSymbol = isSymbol(value);
              var othIsDefined = other !== undefined2, othIsNull = other === null, othIsReflexive = other === other, othIsSymbol = isSymbol(other);
              if (!othIsNull && !othIsSymbol && !valIsSymbol && value > other || valIsSymbol && othIsDefined && othIsReflexive && !othIsNull && !othIsSymbol || valIsNull && othIsDefined && othIsReflexive || !valIsDefined && othIsReflexive || !valIsReflexive) {
                return 1;
              }
              if (!valIsNull && !valIsSymbol && !othIsSymbol && value < other || othIsSymbol && valIsDefined && valIsReflexive && !valIsNull && !valIsSymbol || othIsNull && valIsDefined && valIsReflexive || !othIsDefined && valIsReflexive || !othIsReflexive) {
                return -1;
              }
            }
            return 0;
          }
          function compareMultiple(object2, other, orders) {
            var index = -1, objCriteria = object2.criteria, othCriteria = other.criteria, length = objCriteria.length, ordersLength = orders.length;
            while (++index < length) {
              var result4 = compareAscending(objCriteria[index], othCriteria[index]);
              if (result4) {
                if (index >= ordersLength) {
                  return result4;
                }
                var order = orders[index];
                return result4 * (order == "desc" ? -1 : 1);
              }
            }
            return object2.index - other.index;
          }
          function composeArgs(args, partials, holders, isCurried) {
            var argsIndex = -1, argsLength = args.length, holdersLength = holders.length, leftIndex = -1, leftLength = partials.length, rangeLength = nativeMax(argsLength - holdersLength, 0), result4 = Array2(leftLength + rangeLength), isUncurried = !isCurried;
            while (++leftIndex < leftLength) {
              result4[leftIndex] = partials[leftIndex];
            }
            while (++argsIndex < holdersLength) {
              if (isUncurried || argsIndex < argsLength) {
                result4[holders[argsIndex]] = args[argsIndex];
              }
            }
            while (rangeLength--) {
              result4[leftIndex++] = args[argsIndex++];
            }
            return result4;
          }
          function composeArgsRight(args, partials, holders, isCurried) {
            var argsIndex = -1, argsLength = args.length, holdersIndex = -1, holdersLength = holders.length, rightIndex = -1, rightLength = partials.length, rangeLength = nativeMax(argsLength - holdersLength, 0), result4 = Array2(rangeLength + rightLength), isUncurried = !isCurried;
            while (++argsIndex < rangeLength) {
              result4[argsIndex] = args[argsIndex];
            }
            var offset = argsIndex;
            while (++rightIndex < rightLength) {
              result4[offset + rightIndex] = partials[rightIndex];
            }
            while (++holdersIndex < holdersLength) {
              if (isUncurried || argsIndex < argsLength) {
                result4[offset + holders[holdersIndex]] = args[argsIndex++];
              }
            }
            return result4;
          }
          function copyArray(source, array) {
            var index = -1, length = source.length;
            array || (array = Array2(length));
            while (++index < length) {
              array[index] = source[index];
            }
            return array;
          }
          function copyObject(source, props, object2, customizer) {
            var isNew = !object2;
            object2 || (object2 = {});
            var index = -1, length = props.length;
            while (++index < length) {
              var key = props[index];
              var newValue = customizer ? customizer(object2[key], source[key], key, object2, source) : undefined2;
              if (newValue === undefined2) {
                newValue = source[key];
              }
              if (isNew) {
                baseAssignValue(object2, key, newValue);
              } else {
                assignValue(object2, key, newValue);
              }
            }
            return object2;
          }
          function copySymbols(source, object2) {
            return copyObject(source, getSymbols(source), object2);
          }
          function copySymbolsIn(source, object2) {
            return copyObject(source, getSymbolsIn(source), object2);
          }
          function createAggregator(setter, initializer) {
            return function(collection, iteratee2) {
              var func = isArray(collection) ? arrayAggregator : baseAggregator, accumulator = initializer ? initializer() : {};
              return func(collection, setter, getIteratee(iteratee2, 2), accumulator);
            };
          }
          function createAssigner(assigner) {
            return baseRest(function(object2, sources) {
              var index = -1, length = sources.length, customizer = length > 1 ? sources[length - 1] : undefined2, guard = length > 2 ? sources[2] : undefined2;
              customizer = assigner.length > 3 && typeof customizer == "function" ? (length--, customizer) : undefined2;
              if (guard && isIterateeCall(sources[0], sources[1], guard)) {
                customizer = length < 3 ? undefined2 : customizer;
                length = 1;
              }
              object2 = Object2(object2);
              while (++index < length) {
                var source = sources[index];
                if (source) {
                  assigner(object2, source, index, customizer);
                }
              }
              return object2;
            });
          }
          function createBaseEach(eachFunc, fromRight) {
            return function(collection, iteratee2) {
              if (collection == null) {
                return collection;
              }
              if (!isArrayLike(collection)) {
                return eachFunc(collection, iteratee2);
              }
              var length = collection.length, index = fromRight ? length : -1, iterable = Object2(collection);
              while (fromRight ? index-- : ++index < length) {
                if (iteratee2(iterable[index], index, iterable) === false) {
                  break;
                }
              }
              return collection;
            };
          }
          function createBaseFor(fromRight) {
            return function(object2, iteratee2, keysFunc) {
              var index = -1, iterable = Object2(object2), props = keysFunc(object2), length = props.length;
              while (length--) {
                var key = props[fromRight ? length : ++index];
                if (iteratee2(iterable[key], key, iterable) === false) {
                  break;
                }
              }
              return object2;
            };
          }
          function createBind(func, bitmask, thisArg) {
            var isBind = bitmask & WRAP_BIND_FLAG, Ctor = createCtor(func);
            function wrapper() {
              var fn = this && this !== root && this instanceof wrapper ? Ctor : func;
              return fn.apply(isBind ? thisArg : this, arguments);
            }
            return wrapper;
          }
          function createCaseFirst(methodName) {
            return function(string) {
              string = toString(string);
              var strSymbols = hasUnicode(string) ? stringToArray(string) : undefined2;
              var chr = strSymbols ? strSymbols[0] : string.charAt(0);
              var trailing = strSymbols ? castSlice(strSymbols, 1).join("") : string.slice(1);
              return chr[methodName]() + trailing;
            };
          }
          function createCompounder(callback) {
            return function(string) {
              return arrayReduce(words(deburr(string).replace(reApos, "")), callback, "");
            };
          }
          function createCtor(Ctor) {
            return function() {
              var args = arguments;
              switch (args.length) {
                case 0:
                  return new Ctor();
                case 1:
                  return new Ctor(args[0]);
                case 2:
                  return new Ctor(args[0], args[1]);
                case 3:
                  return new Ctor(args[0], args[1], args[2]);
                case 4:
                  return new Ctor(args[0], args[1], args[2], args[3]);
                case 5:
                  return new Ctor(args[0], args[1], args[2], args[3], args[4]);
                case 6:
                  return new Ctor(args[0], args[1], args[2], args[3], args[4], args[5]);
                case 7:
                  return new Ctor(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
              }
              var thisBinding = baseCreate(Ctor.prototype), result4 = Ctor.apply(thisBinding, args);
              return isObject(result4) ? result4 : thisBinding;
            };
          }
          function createCurry(func, bitmask, arity) {
            var Ctor = createCtor(func);
            function wrapper() {
              var length = arguments.length, args = Array2(length), index = length, placeholder = getHolder(wrapper);
              while (index--) {
                args[index] = arguments[index];
              }
              var holders = length < 3 && args[0] !== placeholder && args[length - 1] !== placeholder ? [] : replaceHolders(args, placeholder);
              length -= holders.length;
              if (length < arity) {
                return createRecurry(
                  func,
                  bitmask,
                  createHybrid,
                  wrapper.placeholder,
                  undefined2,
                  args,
                  holders,
                  undefined2,
                  undefined2,
                  arity - length
                );
              }
              var fn = this && this !== root && this instanceof wrapper ? Ctor : func;
              return apply(fn, this, args);
            }
            return wrapper;
          }
          function createFind(findIndexFunc) {
            return function(collection, predicate, fromIndex) {
              var iterable = Object2(collection);
              if (!isArrayLike(collection)) {
                var iteratee2 = getIteratee(predicate, 3);
                collection = keys(collection);
                predicate = function(key) {
                  return iteratee2(iterable[key], key, iterable);
                };
              }
              var index = findIndexFunc(collection, predicate, fromIndex);
              return index > -1 ? iterable[iteratee2 ? collection[index] : index] : undefined2;
            };
          }
          function createFlow(fromRight) {
            return flatRest(function(funcs) {
              var length = funcs.length, index = length, prereq = LodashWrapper.prototype.thru;
              if (fromRight) {
                funcs.reverse();
              }
              while (index--) {
                var func = funcs[index];
                if (typeof func != "function") {
                  throw new TypeError2(FUNC_ERROR_TEXT);
                }
                if (prereq && !wrapper && getFuncName(func) == "wrapper") {
                  var wrapper = new LodashWrapper([], true);
                }
              }
              index = wrapper ? index : length;
              while (++index < length) {
                func = funcs[index];
                var funcName = getFuncName(func), data = funcName == "wrapper" ? getData(func) : undefined2;
                if (data && isLaziable(data[0]) && data[1] == (WRAP_ARY_FLAG | WRAP_CURRY_FLAG | WRAP_PARTIAL_FLAG | WRAP_REARG_FLAG) && !data[4].length && data[9] == 1) {
                  wrapper = wrapper[getFuncName(data[0])].apply(wrapper, data[3]);
                } else {
                  wrapper = func.length == 1 && isLaziable(func) ? wrapper[funcName]() : wrapper.thru(func);
                }
              }
              return function() {
                var args = arguments, value = args[0];
                if (wrapper && args.length == 1 && isArray(value)) {
                  return wrapper.plant(value).value();
                }
                var index2 = 0, result4 = length ? funcs[index2].apply(this, args) : value;
                while (++index2 < length) {
                  result4 = funcs[index2].call(this, result4);
                }
                return result4;
              };
            });
          }
          function createHybrid(func, bitmask, thisArg, partials, holders, partialsRight, holdersRight, argPos, ary2, arity) {
            var isAry = bitmask & WRAP_ARY_FLAG, isBind = bitmask & WRAP_BIND_FLAG, isBindKey = bitmask & WRAP_BIND_KEY_FLAG, isCurried = bitmask & (WRAP_CURRY_FLAG | WRAP_CURRY_RIGHT_FLAG), isFlip = bitmask & WRAP_FLIP_FLAG, Ctor = isBindKey ? undefined2 : createCtor(func);
            function wrapper() {
              var length = arguments.length, args = Array2(length), index = length;
              while (index--) {
                args[index] = arguments[index];
              }
              if (isCurried) {
                var placeholder = getHolder(wrapper), holdersCount = countHolders(args, placeholder);
              }
              if (partials) {
                args = composeArgs(args, partials, holders, isCurried);
              }
              if (partialsRight) {
                args = composeArgsRight(args, partialsRight, holdersRight, isCurried);
              }
              length -= holdersCount;
              if (isCurried && length < arity) {
                var newHolders = replaceHolders(args, placeholder);
                return createRecurry(
                  func,
                  bitmask,
                  createHybrid,
                  wrapper.placeholder,
                  thisArg,
                  args,
                  newHolders,
                  argPos,
                  ary2,
                  arity - length
                );
              }
              var thisBinding = isBind ? thisArg : this, fn = isBindKey ? thisBinding[func] : func;
              length = args.length;
              if (argPos) {
                args = reorder(args, argPos);
              } else if (isFlip && length > 1) {
                args.reverse();
              }
              if (isAry && ary2 < length) {
                args.length = ary2;
              }
              if (this && this !== root && this instanceof wrapper) {
                fn = Ctor || createCtor(fn);
              }
              return fn.apply(thisBinding, args);
            }
            return wrapper;
          }
          function createInverter(setter, toIteratee) {
            return function(object2, iteratee2) {
              return baseInverter(object2, setter, toIteratee(iteratee2), {});
            };
          }
          function createMathOperation(operator, defaultValue) {
            return function(value, other) {
              var result4;
              if (value === undefined2 && other === undefined2) {
                return defaultValue;
              }
              if (value !== undefined2) {
                result4 = value;
              }
              if (other !== undefined2) {
                if (result4 === undefined2) {
                  return other;
                }
                if (typeof value == "string" || typeof other == "string") {
                  value = baseToString(value);
                  other = baseToString(other);
                } else {
                  value = baseToNumber(value);
                  other = baseToNumber(other);
                }
                result4 = operator(value, other);
              }
              return result4;
            };
          }
          function createOver(arrayFunc) {
            return flatRest(function(iteratees) {
              iteratees = arrayMap(iteratees, baseUnary(getIteratee()));
              return baseRest(function(args) {
                var thisArg = this;
                return arrayFunc(iteratees, function(iteratee2) {
                  return apply(iteratee2, thisArg, args);
                });
              });
            });
          }
          function createPadding(length, chars2) {
            chars2 = chars2 === undefined2 ? " " : baseToString(chars2);
            var charsLength = chars2.length;
            if (charsLength < 2) {
              return charsLength ? baseRepeat(chars2, length) : chars2;
            }
            var result4 = baseRepeat(chars2, nativeCeil(length / stringSize(chars2)));
            return hasUnicode(chars2) ? castSlice(stringToArray(result4), 0, length).join("") : result4.slice(0, length);
          }
          function createPartial(func, bitmask, thisArg, partials) {
            var isBind = bitmask & WRAP_BIND_FLAG, Ctor = createCtor(func);
            function wrapper() {
              var argsIndex = -1, argsLength = arguments.length, leftIndex = -1, leftLength = partials.length, args = Array2(leftLength + argsLength), fn = this && this !== root && this instanceof wrapper ? Ctor : func;
              while (++leftIndex < leftLength) {
                args[leftIndex] = partials[leftIndex];
              }
              while (argsLength--) {
                args[leftIndex++] = arguments[++argsIndex];
              }
              return apply(fn, isBind ? thisArg : this, args);
            }
            return wrapper;
          }
          function createRange(fromRight) {
            return function(start2, end, step) {
              if (step && typeof step != "number" && isIterateeCall(start2, end, step)) {
                end = step = undefined2;
              }
              start2 = toFinite(start2);
              if (end === undefined2) {
                end = start2;
                start2 = 0;
              } else {
                end = toFinite(end);
              }
              step = step === undefined2 ? start2 < end ? 1 : -1 : toFinite(step);
              return baseRange(start2, end, step, fromRight);
            };
          }
          function createRelationalOperation(operator) {
            return function(value, other) {
              if (!(typeof value == "string" && typeof other == "string")) {
                value = toNumber(value);
                other = toNumber(other);
              }
              return operator(value, other);
            };
          }
          function createRecurry(func, bitmask, wrapFunc, placeholder, thisArg, partials, holders, argPos, ary2, arity) {
            var isCurry = bitmask & WRAP_CURRY_FLAG, newHolders = isCurry ? holders : undefined2, newHoldersRight = isCurry ? undefined2 : holders, newPartials = isCurry ? partials : undefined2, newPartialsRight = isCurry ? undefined2 : partials;
            bitmask |= isCurry ? WRAP_PARTIAL_FLAG : WRAP_PARTIAL_RIGHT_FLAG;
            bitmask &= ~(isCurry ? WRAP_PARTIAL_RIGHT_FLAG : WRAP_PARTIAL_FLAG);
            if (!(bitmask & WRAP_CURRY_BOUND_FLAG)) {
              bitmask &= ~(WRAP_BIND_FLAG | WRAP_BIND_KEY_FLAG);
            }
            var newData = [
              func,
              bitmask,
              thisArg,
              newPartials,
              newHolders,
              newPartialsRight,
              newHoldersRight,
              argPos,
              ary2,
              arity
            ];
            var result4 = wrapFunc.apply(undefined2, newData);
            if (isLaziable(func)) {
              setData(result4, newData);
            }
            result4.placeholder = placeholder;
            return setWrapToString(result4, func, bitmask);
          }
          function createRound(methodName) {
            var func = Math2[methodName];
            return function(number, precision) {
              number = toNumber(number);
              precision = precision == null ? 0 : nativeMin(toInteger(precision), 292);
              if (precision && nativeIsFinite(number)) {
                var pair = (toString(number) + "e").split("e"), value = func(pair[0] + "e" + (+pair[1] + precision));
                pair = (toString(value) + "e").split("e");
                return +(pair[0] + "e" + (+pair[1] - precision));
              }
              return func(number);
            };
          }
          var createSet = !(Set2 && 1 / setToArray(new Set2([, -0]))[1] == INFINITY) ? noop2 : function(values2) {
            return new Set2(values2);
          };
          function createToPairs(keysFunc) {
            return function(object2) {
              var tag = getTag(object2);
              if (tag == mapTag) {
                return mapToArray(object2);
              }
              if (tag == setTag) {
                return setToPairs(object2);
              }
              return baseToPairs(object2, keysFunc(object2));
            };
          }
          function createWrap(func, bitmask, thisArg, partials, holders, argPos, ary2, arity) {
            var isBindKey = bitmask & WRAP_BIND_KEY_FLAG;
            if (!isBindKey && typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            var length = partials ? partials.length : 0;
            if (!length) {
              bitmask &= ~(WRAP_PARTIAL_FLAG | WRAP_PARTIAL_RIGHT_FLAG);
              partials = holders = undefined2;
            }
            ary2 = ary2 === undefined2 ? ary2 : nativeMax(toInteger(ary2), 0);
            arity = arity === undefined2 ? arity : toInteger(arity);
            length -= holders ? holders.length : 0;
            if (bitmask & WRAP_PARTIAL_RIGHT_FLAG) {
              var partialsRight = partials, holdersRight = holders;
              partials = holders = undefined2;
            }
            var data = isBindKey ? undefined2 : getData(func);
            var newData = [
              func,
              bitmask,
              thisArg,
              partials,
              holders,
              partialsRight,
              holdersRight,
              argPos,
              ary2,
              arity
            ];
            if (data) {
              mergeData(newData, data);
            }
            func = newData[0];
            bitmask = newData[1];
            thisArg = newData[2];
            partials = newData[3];
            holders = newData[4];
            arity = newData[9] = newData[9] === undefined2 ? isBindKey ? 0 : func.length : nativeMax(newData[9] - length, 0);
            if (!arity && bitmask & (WRAP_CURRY_FLAG | WRAP_CURRY_RIGHT_FLAG)) {
              bitmask &= ~(WRAP_CURRY_FLAG | WRAP_CURRY_RIGHT_FLAG);
            }
            if (!bitmask || bitmask == WRAP_BIND_FLAG) {
              var result4 = createBind(func, bitmask, thisArg);
            } else if (bitmask == WRAP_CURRY_FLAG || bitmask == WRAP_CURRY_RIGHT_FLAG) {
              result4 = createCurry(func, bitmask, arity);
            } else if ((bitmask == WRAP_PARTIAL_FLAG || bitmask == (WRAP_BIND_FLAG | WRAP_PARTIAL_FLAG)) && !holders.length) {
              result4 = createPartial(func, bitmask, thisArg, partials);
            } else {
              result4 = createHybrid.apply(undefined2, newData);
            }
            var setter = data ? baseSetData : setData;
            return setWrapToString(setter(result4, newData), func, bitmask);
          }
          function customDefaultsAssignIn(objValue, srcValue, key, object2) {
            if (objValue === undefined2 || eq(objValue, objectProto[key]) && !hasOwnProperty.call(object2, key)) {
              return srcValue;
            }
            return objValue;
          }
          function customDefaultsMerge(objValue, srcValue, key, object2, source, stack) {
            if (isObject(objValue) && isObject(srcValue)) {
              stack.set(srcValue, objValue);
              baseMerge(objValue, srcValue, undefined2, customDefaultsMerge, stack);
              stack["delete"](srcValue);
            }
            return objValue;
          }
          function customOmitClone(value) {
            return isPlainObject(value) ? undefined2 : value;
          }
          function equalArrays(array, other, bitmask, customizer, equalFunc, stack) {
            var isPartial = bitmask & COMPARE_PARTIAL_FLAG, arrLength = array.length, othLength = other.length;
            if (arrLength != othLength && !(isPartial && othLength > arrLength)) {
              return false;
            }
            var arrStacked = stack.get(array);
            var othStacked = stack.get(other);
            if (arrStacked && othStacked) {
              return arrStacked == other && othStacked == array;
            }
            var index = -1, result4 = true, seen = bitmask & COMPARE_UNORDERED_FLAG ? new SetCache() : undefined2;
            stack.set(array, other);
            stack.set(other, array);
            while (++index < arrLength) {
              var arrValue = array[index], othValue = other[index];
              if (customizer) {
                var compared = isPartial ? customizer(othValue, arrValue, index, other, array, stack) : customizer(arrValue, othValue, index, array, other, stack);
              }
              if (compared !== undefined2) {
                if (compared) {
                  continue;
                }
                result4 = false;
                break;
              }
              if (seen) {
                if (!arraySome(other, function(othValue2, othIndex) {
                  if (!cacheHas(seen, othIndex) && (arrValue === othValue2 || equalFunc(arrValue, othValue2, bitmask, customizer, stack))) {
                    return seen.push(othIndex);
                  }
                })) {
                  result4 = false;
                  break;
                }
              } else if (!(arrValue === othValue || equalFunc(arrValue, othValue, bitmask, customizer, stack))) {
                result4 = false;
                break;
              }
            }
            stack["delete"](array);
            stack["delete"](other);
            return result4;
          }
          function equalByTag(object2, other, tag, bitmask, customizer, equalFunc, stack) {
            switch (tag) {
              case dataViewTag:
                if (object2.byteLength != other.byteLength || object2.byteOffset != other.byteOffset) {
                  return false;
                }
                object2 = object2.buffer;
                other = other.buffer;
              case arrayBufferTag:
                if (object2.byteLength != other.byteLength || !equalFunc(new Uint8Array2(object2), new Uint8Array2(other))) {
                  return false;
                }
                return true;
              case boolTag:
              case dateTag:
              case numberTag:
                return eq(+object2, +other);
              case errorTag:
                return object2.name == other.name && object2.message == other.message;
              case regexpTag:
              case stringTag:
                return object2 == other + "";
              case mapTag:
                var convert = mapToArray;
              case setTag:
                var isPartial = bitmask & COMPARE_PARTIAL_FLAG;
                convert || (convert = setToArray);
                if (object2.size != other.size && !isPartial) {
                  return false;
                }
                var stacked = stack.get(object2);
                if (stacked) {
                  return stacked == other;
                }
                bitmask |= COMPARE_UNORDERED_FLAG;
                stack.set(object2, other);
                var result4 = equalArrays(convert(object2), convert(other), bitmask, customizer, equalFunc, stack);
                stack["delete"](object2);
                return result4;
              case symbolTag:
                if (symbolValueOf) {
                  return symbolValueOf.call(object2) == symbolValueOf.call(other);
                }
            }
            return false;
          }
          function equalObjects(object2, other, bitmask, customizer, equalFunc, stack) {
            var isPartial = bitmask & COMPARE_PARTIAL_FLAG, objProps = getAllKeys(object2), objLength = objProps.length, othProps = getAllKeys(other), othLength = othProps.length;
            if (objLength != othLength && !isPartial) {
              return false;
            }
            var index = objLength;
            while (index--) {
              var key = objProps[index];
              if (!(isPartial ? key in other : hasOwnProperty.call(other, key))) {
                return false;
              }
            }
            var objStacked = stack.get(object2);
            var othStacked = stack.get(other);
            if (objStacked && othStacked) {
              return objStacked == other && othStacked == object2;
            }
            var result4 = true;
            stack.set(object2, other);
            stack.set(other, object2);
            var skipCtor = isPartial;
            while (++index < objLength) {
              key = objProps[index];
              var objValue = object2[key], othValue = other[key];
              if (customizer) {
                var compared = isPartial ? customizer(othValue, objValue, key, other, object2, stack) : customizer(objValue, othValue, key, object2, other, stack);
              }
              if (!(compared === undefined2 ? objValue === othValue || equalFunc(objValue, othValue, bitmask, customizer, stack) : compared)) {
                result4 = false;
                break;
              }
              skipCtor || (skipCtor = key == "constructor");
            }
            if (result4 && !skipCtor) {
              var objCtor = object2.constructor, othCtor = other.constructor;
              if (objCtor != othCtor && ("constructor" in object2 && "constructor" in other) && !(typeof objCtor == "function" && objCtor instanceof objCtor && typeof othCtor == "function" && othCtor instanceof othCtor)) {
                result4 = false;
              }
            }
            stack["delete"](object2);
            stack["delete"](other);
            return result4;
          }
          function flatRest(func) {
            return setToString(overRest(func, undefined2, flatten), func + "");
          }
          function getAllKeys(object2) {
            return baseGetAllKeys(object2, keys, getSymbols);
          }
          function getAllKeysIn(object2) {
            return baseGetAllKeys(object2, keysIn, getSymbolsIn);
          }
          var getData = !metaMap ? noop2 : function(func) {
            return metaMap.get(func);
          };
          function getFuncName(func) {
            var result4 = func.name + "", array = realNames[result4], length = hasOwnProperty.call(realNames, result4) ? array.length : 0;
            while (length--) {
              var data = array[length], otherFunc = data.func;
              if (otherFunc == null || otherFunc == func) {
                return data.name;
              }
            }
            return result4;
          }
          function getHolder(func) {
            var object2 = hasOwnProperty.call(lodash, "placeholder") ? lodash : func;
            return object2.placeholder;
          }
          function getIteratee() {
            var result4 = lodash.iteratee || iteratee;
            result4 = result4 === iteratee ? baseIteratee : result4;
            return arguments.length ? result4(arguments[0], arguments[1]) : result4;
          }
          function getMapData(map2, key) {
            var data = map2.__data__;
            return isKeyable(key) ? data[typeof key == "string" ? "string" : "hash"] : data.map;
          }
          function getMatchData(object2) {
            var result4 = keys(object2), length = result4.length;
            while (length--) {
              var key = result4[length], value = object2[key];
              result4[length] = [key, value, isStrictComparable(value)];
            }
            return result4;
          }
          function getNative(object2, key) {
            var value = getValue(object2, key);
            return baseIsNative(value) ? value : undefined2;
          }
          function getRawTag(value) {
            var isOwn = hasOwnProperty.call(value, symToStringTag), tag = value[symToStringTag];
            try {
              value[symToStringTag] = undefined2;
              var unmasked = true;
            } catch (e) {
            }
            var result4 = nativeObjectToString.call(value);
            if (unmasked) {
              if (isOwn) {
                value[symToStringTag] = tag;
              } else {
                delete value[symToStringTag];
              }
            }
            return result4;
          }
          var getSymbols = !nativeGetSymbols ? stubArray : function(object2) {
            if (object2 == null) {
              return [];
            }
            object2 = Object2(object2);
            return arrayFilter(nativeGetSymbols(object2), function(symbol) {
              return propertyIsEnumerable.call(object2, symbol);
            });
          };
          var getSymbolsIn = !nativeGetSymbols ? stubArray : function(object2) {
            var result4 = [];
            while (object2) {
              arrayPush(result4, getSymbols(object2));
              object2 = getPrototype(object2);
            }
            return result4;
          };
          var getTag = baseGetTag;
          if (DataView && getTag(new DataView(new ArrayBuffer(1))) != dataViewTag || Map2 && getTag(new Map2()) != mapTag || Promise2 && getTag(Promise2.resolve()) != promiseTag || Set2 && getTag(new Set2()) != setTag || WeakMap && getTag(new WeakMap()) != weakMapTag) {
            getTag = function(value) {
              var result4 = baseGetTag(value), Ctor = result4 == objectTag ? value.constructor : undefined2, ctorString = Ctor ? toSource(Ctor) : "";
              if (ctorString) {
                switch (ctorString) {
                  case dataViewCtorString:
                    return dataViewTag;
                  case mapCtorString:
                    return mapTag;
                  case promiseCtorString:
                    return promiseTag;
                  case setCtorString:
                    return setTag;
                  case weakMapCtorString:
                    return weakMapTag;
                }
              }
              return result4;
            };
          }
          function getView(start2, end, transforms) {
            var index = -1, length = transforms.length;
            while (++index < length) {
              var data = transforms[index], size2 = data.size;
              switch (data.type) {
                case "drop":
                  start2 += size2;
                  break;
                case "dropRight":
                  end -= size2;
                  break;
                case "take":
                  end = nativeMin(end, start2 + size2);
                  break;
                case "takeRight":
                  start2 = nativeMax(start2, end - size2);
                  break;
              }
            }
            return { "start": start2, "end": end };
          }
          function getWrapDetails(source) {
            var match = source.match(reWrapDetails);
            return match ? match[1].split(reSplitDetails) : [];
          }
          function hasPath(object2, path, hasFunc) {
            path = castPath(path, object2);
            var index = -1, length = path.length, result4 = false;
            while (++index < length) {
              var key = toKey(path[index]);
              if (!(result4 = object2 != null && hasFunc(object2, key))) {
                break;
              }
              object2 = object2[key];
            }
            if (result4 || ++index != length) {
              return result4;
            }
            length = object2 == null ? 0 : object2.length;
            return !!length && isLength(length) && isIndex(key, length) && (isArray(object2) || isArguments(object2));
          }
          function initCloneArray(array) {
            var length = array.length, result4 = new array.constructor(length);
            if (length && typeof array[0] == "string" && hasOwnProperty.call(array, "index")) {
              result4.index = array.index;
              result4.input = array.input;
            }
            return result4;
          }
          function initCloneObject(object2) {
            return typeof object2.constructor == "function" && !isPrototype(object2) ? baseCreate(getPrototype(object2)) : {};
          }
          function initCloneByTag(object2, tag, isDeep) {
            var Ctor = object2.constructor;
            switch (tag) {
              case arrayBufferTag:
                return cloneArrayBuffer(object2);
              case boolTag:
              case dateTag:
                return new Ctor(+object2);
              case dataViewTag:
                return cloneDataView(object2, isDeep);
              case float32Tag:
              case float64Tag:
              case int8Tag:
              case int16Tag:
              case int32Tag:
              case uint8Tag:
              case uint8ClampedTag:
              case uint16Tag:
              case uint32Tag:
                return cloneTypedArray(object2, isDeep);
              case mapTag:
                return new Ctor();
              case numberTag:
              case stringTag:
                return new Ctor(object2);
              case regexpTag:
                return cloneRegExp(object2);
              case setTag:
                return new Ctor();
              case symbolTag:
                return cloneSymbol(object2);
            }
          }
          function insertWrapDetails(source, details) {
            var length = details.length;
            if (!length) {
              return source;
            }
            var lastIndex = length - 1;
            details[lastIndex] = (length > 1 ? "& " : "") + details[lastIndex];
            details = details.join(length > 2 ? ", " : " ");
            return source.replace(reWrapComment, "{\n/* [wrapped with " + details + "] */\n");
          }
          function isFlattenable(value) {
            return isArray(value) || isArguments(value) || !!(spreadableSymbol && value && value[spreadableSymbol]);
          }
          function isIndex(value, length) {
            var type = typeof value;
            length = length == null ? MAX_SAFE_INTEGER : length;
            return !!length && (type == "number" || type != "symbol" && reIsUint.test(value)) && (value > -1 && value % 1 == 0 && value < length);
          }
          function isIterateeCall(value, index, object2) {
            if (!isObject(object2)) {
              return false;
            }
            var type = typeof index;
            if (type == "number" ? isArrayLike(object2) && isIndex(index, object2.length) : type == "string" && index in object2) {
              return eq(object2[index], value);
            }
            return false;
          }
          function isKey(value, object2) {
            if (isArray(value)) {
              return false;
            }
            var type = typeof value;
            if (type == "number" || type == "symbol" || type == "boolean" || value == null || isSymbol(value)) {
              return true;
            }
            return reIsPlainProp.test(value) || !reIsDeepProp.test(value) || object2 != null && value in Object2(object2);
          }
          function isKeyable(value) {
            var type = typeof value;
            return type == "string" || type == "number" || type == "symbol" || type == "boolean" ? value !== "__proto__" : value === null;
          }
          function isLaziable(func) {
            var funcName = getFuncName(func), other = lodash[funcName];
            if (typeof other != "function" || !(funcName in LazyWrapper.prototype)) {
              return false;
            }
            if (func === other) {
              return true;
            }
            var data = getData(other);
            return !!data && func === data[0];
          }
          function isMasked(func) {
            return !!maskSrcKey && maskSrcKey in func;
          }
          var isMaskable = coreJsData ? isFunction : stubFalse;
          function isPrototype(value) {
            var Ctor = value && value.constructor, proto = typeof Ctor == "function" && Ctor.prototype || objectProto;
            return value === proto;
          }
          function isStrictComparable(value) {
            return value === value && !isObject(value);
          }
          function matchesStrictComparable(key, srcValue) {
            return function(object2) {
              if (object2 == null) {
                return false;
              }
              return object2[key] === srcValue && (srcValue !== undefined2 || key in Object2(object2));
            };
          }
          function memoizeCapped(func) {
            var result4 = memoize(func, function(key) {
              if (cache.size === MAX_MEMOIZE_SIZE) {
                cache.clear();
              }
              return key;
            });
            var cache = result4.cache;
            return result4;
          }
          function mergeData(data, source) {
            var bitmask = data[1], srcBitmask = source[1], newBitmask = bitmask | srcBitmask, isCommon = newBitmask < (WRAP_BIND_FLAG | WRAP_BIND_KEY_FLAG | WRAP_ARY_FLAG);
            var isCombo = srcBitmask == WRAP_ARY_FLAG && bitmask == WRAP_CURRY_FLAG || srcBitmask == WRAP_ARY_FLAG && bitmask == WRAP_REARG_FLAG && data[7].length <= source[8] || srcBitmask == (WRAP_ARY_FLAG | WRAP_REARG_FLAG) && source[7].length <= source[8] && bitmask == WRAP_CURRY_FLAG;
            if (!(isCommon || isCombo)) {
              return data;
            }
            if (srcBitmask & WRAP_BIND_FLAG) {
              data[2] = source[2];
              newBitmask |= bitmask & WRAP_BIND_FLAG ? 0 : WRAP_CURRY_BOUND_FLAG;
            }
            var value = source[3];
            if (value) {
              var partials = data[3];
              data[3] = partials ? composeArgs(partials, value, source[4]) : value;
              data[4] = partials ? replaceHolders(data[3], PLACEHOLDER) : source[4];
            }
            value = source[5];
            if (value) {
              partials = data[5];
              data[5] = partials ? composeArgsRight(partials, value, source[6]) : value;
              data[6] = partials ? replaceHolders(data[5], PLACEHOLDER) : source[6];
            }
            value = source[7];
            if (value) {
              data[7] = value;
            }
            if (srcBitmask & WRAP_ARY_FLAG) {
              data[8] = data[8] == null ? source[8] : nativeMin(data[8], source[8]);
            }
            if (data[9] == null) {
              data[9] = source[9];
            }
            data[0] = source[0];
            data[1] = newBitmask;
            return data;
          }
          function nativeKeysIn(object2) {
            var result4 = [];
            if (object2 != null) {
              for (var key in Object2(object2)) {
                result4.push(key);
              }
            }
            return result4;
          }
          function objectToString(value) {
            return nativeObjectToString.call(value);
          }
          function overRest(func, start2, transform2) {
            start2 = nativeMax(start2 === undefined2 ? func.length - 1 : start2, 0);
            return function() {
              var args = arguments, index = -1, length = nativeMax(args.length - start2, 0), array = Array2(length);
              while (++index < length) {
                array[index] = args[start2 + index];
              }
              index = -1;
              var otherArgs = Array2(start2 + 1);
              while (++index < start2) {
                otherArgs[index] = args[index];
              }
              otherArgs[start2] = transform2(array);
              return apply(func, this, otherArgs);
            };
          }
          function parent(object2, path) {
            return path.length < 2 ? object2 : baseGet(object2, baseSlice(path, 0, -1));
          }
          function reorder(array, indexes) {
            var arrLength = array.length, length = nativeMin(indexes.length, arrLength), oldArray = copyArray(array);
            while (length--) {
              var index = indexes[length];
              array[length] = isIndex(index, arrLength) ? oldArray[index] : undefined2;
            }
            return array;
          }
          function safeGet(object2, key) {
            if (key === "constructor" && typeof object2[key] === "function") {
              return;
            }
            if (key == "__proto__") {
              return;
            }
            return object2[key];
          }
          var setData = shortOut(baseSetData);
          var setTimeout2 = ctxSetTimeout || function(func, wait) {
            return root.setTimeout(func, wait);
          };
          var setToString = shortOut(baseSetToString);
          function setWrapToString(wrapper, reference, bitmask) {
            var source = reference + "";
            return setToString(wrapper, insertWrapDetails(source, updateWrapDetails(getWrapDetails(source), bitmask)));
          }
          function shortOut(func) {
            var count = 0, lastCalled = 0;
            return function() {
              var stamp = nativeNow(), remaining = HOT_SPAN - (stamp - lastCalled);
              lastCalled = stamp;
              if (remaining > 0) {
                if (++count >= HOT_COUNT) {
                  return arguments[0];
                }
              } else {
                count = 0;
              }
              return func.apply(undefined2, arguments);
            };
          }
          function shuffleSelf(array, size2) {
            var index = -1, length = array.length, lastIndex = length - 1;
            size2 = size2 === undefined2 ? length : size2;
            while (++index < size2) {
              var rand = baseRandom(index, lastIndex), value = array[rand];
              array[rand] = array[index];
              array[index] = value;
            }
            array.length = size2;
            return array;
          }
          var stringToPath = memoizeCapped(function(string) {
            var result4 = [];
            if (string.charCodeAt(0) === 46) {
              result4.push("");
            }
            string.replace(rePropName, function(match, number, quote, subString) {
              result4.push(quote ? subString.replace(reEscapeChar, "$1") : number || match);
            });
            return result4;
          });
          function toKey(value) {
            if (typeof value == "string" || isSymbol(value)) {
              return value;
            }
            var result4 = value + "";
            return result4 == "0" && 1 / value == -INFINITY ? "-0" : result4;
          }
          function toSource(func) {
            if (func != null) {
              try {
                return funcToString.call(func);
              } catch (e) {
              }
              try {
                return func + "";
              } catch (e) {
              }
            }
            return "";
          }
          function updateWrapDetails(details, bitmask) {
            arrayEach(wrapFlags, function(pair) {
              var value = "_." + pair[0];
              if (bitmask & pair[1] && !arrayIncludes(details, value)) {
                details.push(value);
              }
            });
            return details.sort();
          }
          function wrapperClone(wrapper) {
            if (wrapper instanceof LazyWrapper) {
              return wrapper.clone();
            }
            var result4 = new LodashWrapper(wrapper.__wrapped__, wrapper.__chain__);
            result4.__actions__ = copyArray(wrapper.__actions__);
            result4.__index__ = wrapper.__index__;
            result4.__values__ = wrapper.__values__;
            return result4;
          }
          function chunk(array, size2, guard) {
            if (guard ? isIterateeCall(array, size2, guard) : size2 === undefined2) {
              size2 = 1;
            } else {
              size2 = nativeMax(toInteger(size2), 0);
            }
            var length = array == null ? 0 : array.length;
            if (!length || size2 < 1) {
              return [];
            }
            var index = 0, resIndex = 0, result4 = Array2(nativeCeil(length / size2));
            while (index < length) {
              result4[resIndex++] = baseSlice(array, index, index += size2);
            }
            return result4;
          }
          function compact(array) {
            var index = -1, length = array == null ? 0 : array.length, resIndex = 0, result4 = [];
            while (++index < length) {
              var value = array[index];
              if (value) {
                result4[resIndex++] = value;
              }
            }
            return result4;
          }
          function concat() {
            var length = arguments.length;
            if (!length) {
              return [];
            }
            var args = Array2(length - 1), array = arguments[0], index = length;
            while (index--) {
              args[index - 1] = arguments[index];
            }
            return arrayPush(isArray(array) ? copyArray(array) : [array], baseFlatten(args, 1));
          }
          var difference2 = baseRest(function(array, values2) {
            return isArrayLikeObject(array) ? baseDifference(array, baseFlatten(values2, 1, isArrayLikeObject, true)) : [];
          });
          var differenceBy = baseRest(function(array, values2) {
            var iteratee2 = last(values2);
            if (isArrayLikeObject(iteratee2)) {
              iteratee2 = undefined2;
            }
            return isArrayLikeObject(array) ? baseDifference(array, baseFlatten(values2, 1, isArrayLikeObject, true), getIteratee(iteratee2, 2)) : [];
          });
          var differenceWith = baseRest(function(array, values2) {
            var comparator = last(values2);
            if (isArrayLikeObject(comparator)) {
              comparator = undefined2;
            }
            return isArrayLikeObject(array) ? baseDifference(array, baseFlatten(values2, 1, isArrayLikeObject, true), undefined2, comparator) : [];
          });
          function drop(array, n, guard) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            n = guard || n === undefined2 ? 1 : toInteger(n);
            return baseSlice(array, n < 0 ? 0 : n, length);
          }
          function dropRight(array, n, guard) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            n = guard || n === undefined2 ? 1 : toInteger(n);
            n = length - n;
            return baseSlice(array, 0, n < 0 ? 0 : n);
          }
          function dropRightWhile(array, predicate) {
            return array && array.length ? baseWhile(array, getIteratee(predicate, 3), true, true) : [];
          }
          function dropWhile(array, predicate) {
            return array && array.length ? baseWhile(array, getIteratee(predicate, 3), true) : [];
          }
          function fill(array, value, start2, end) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            if (start2 && typeof start2 != "number" && isIterateeCall(array, value, start2)) {
              start2 = 0;
              end = length;
            }
            return baseFill(array, value, start2, end);
          }
          function findIndex(array, predicate, fromIndex) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return -1;
            }
            var index = fromIndex == null ? 0 : toInteger(fromIndex);
            if (index < 0) {
              index = nativeMax(length + index, 0);
            }
            return baseFindIndex(array, getIteratee(predicate, 3), index);
          }
          function findLastIndex(array, predicate, fromIndex) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return -1;
            }
            var index = length - 1;
            if (fromIndex !== undefined2) {
              index = toInteger(fromIndex);
              index = fromIndex < 0 ? nativeMax(length + index, 0) : nativeMin(index, length - 1);
            }
            return baseFindIndex(array, getIteratee(predicate, 3), index, true);
          }
          function flatten(array) {
            var length = array == null ? 0 : array.length;
            return length ? baseFlatten(array, 1) : [];
          }
          function flattenDeep(array) {
            var length = array == null ? 0 : array.length;
            return length ? baseFlatten(array, INFINITY) : [];
          }
          function flattenDepth(array, depth) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            depth = depth === undefined2 ? 1 : toInteger(depth);
            return baseFlatten(array, depth);
          }
          function fromPairs(pairs) {
            var index = -1, length = pairs == null ? 0 : pairs.length, result4 = {};
            while (++index < length) {
              var pair = pairs[index];
              result4[pair[0]] = pair[1];
            }
            return result4;
          }
          function head(array) {
            return array && array.length ? array[0] : undefined2;
          }
          function indexOf(array, value, fromIndex) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return -1;
            }
            var index = fromIndex == null ? 0 : toInteger(fromIndex);
            if (index < 0) {
              index = nativeMax(length + index, 0);
            }
            return baseIndexOf(array, value, index);
          }
          function initial(array) {
            var length = array == null ? 0 : array.length;
            return length ? baseSlice(array, 0, -1) : [];
          }
          var intersection = baseRest(function(arrays) {
            var mapped = arrayMap(arrays, castArrayLikeObject);
            return mapped.length && mapped[0] === arrays[0] ? baseIntersection(mapped) : [];
          });
          var intersectionBy = baseRest(function(arrays) {
            var iteratee2 = last(arrays), mapped = arrayMap(arrays, castArrayLikeObject);
            if (iteratee2 === last(mapped)) {
              iteratee2 = undefined2;
            } else {
              mapped.pop();
            }
            return mapped.length && mapped[0] === arrays[0] ? baseIntersection(mapped, getIteratee(iteratee2, 2)) : [];
          });
          var intersectionWith = baseRest(function(arrays) {
            var comparator = last(arrays), mapped = arrayMap(arrays, castArrayLikeObject);
            comparator = typeof comparator == "function" ? comparator : undefined2;
            if (comparator) {
              mapped.pop();
            }
            return mapped.length && mapped[0] === arrays[0] ? baseIntersection(mapped, undefined2, comparator) : [];
          });
          function join(array, separator) {
            return array == null ? "" : nativeJoin.call(array, separator);
          }
          function last(array) {
            var length = array == null ? 0 : array.length;
            return length ? array[length - 1] : undefined2;
          }
          function lastIndexOf(array, value, fromIndex) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return -1;
            }
            var index = length;
            if (fromIndex !== undefined2) {
              index = toInteger(fromIndex);
              index = index < 0 ? nativeMax(length + index, 0) : nativeMin(index, length - 1);
            }
            return value === value ? strictLastIndexOf(array, value, index) : baseFindIndex(array, baseIsNaN, index, true);
          }
          function nth(array, n) {
            return array && array.length ? baseNth(array, toInteger(n)) : undefined2;
          }
          var pull = baseRest(pullAll);
          function pullAll(array, values2) {
            return array && array.length && values2 && values2.length ? basePullAll(array, values2) : array;
          }
          function pullAllBy(array, values2, iteratee2) {
            return array && array.length && values2 && values2.length ? basePullAll(array, values2, getIteratee(iteratee2, 2)) : array;
          }
          function pullAllWith(array, values2, comparator) {
            return array && array.length && values2 && values2.length ? basePullAll(array, values2, undefined2, comparator) : array;
          }
          var pullAt = flatRest(function(array, indexes) {
            var length = array == null ? 0 : array.length, result4 = baseAt(array, indexes);
            basePullAt(array, arrayMap(indexes, function(index) {
              return isIndex(index, length) ? +index : index;
            }).sort(compareAscending));
            return result4;
          });
          function remove(array, predicate) {
            var result4 = [];
            if (!(array && array.length)) {
              return result4;
            }
            var index = -1, indexes = [], length = array.length;
            predicate = getIteratee(predicate, 3);
            while (++index < length) {
              var value = array[index];
              if (predicate(value, index, array)) {
                result4.push(value);
                indexes.push(index);
              }
            }
            basePullAt(array, indexes);
            return result4;
          }
          function reverse(array) {
            return array == null ? array : nativeReverse.call(array);
          }
          function slice(array, start2, end) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            if (end && typeof end != "number" && isIterateeCall(array, start2, end)) {
              start2 = 0;
              end = length;
            } else {
              start2 = start2 == null ? 0 : toInteger(start2);
              end = end === undefined2 ? length : toInteger(end);
            }
            return baseSlice(array, start2, end);
          }
          function sortedIndex(array, value) {
            return baseSortedIndex(array, value);
          }
          function sortedIndexBy(array, value, iteratee2) {
            return baseSortedIndexBy(array, value, getIteratee(iteratee2, 2));
          }
          function sortedIndexOf(array, value) {
            var length = array == null ? 0 : array.length;
            if (length) {
              var index = baseSortedIndex(array, value);
              if (index < length && eq(array[index], value)) {
                return index;
              }
            }
            return -1;
          }
          function sortedLastIndex(array, value) {
            return baseSortedIndex(array, value, true);
          }
          function sortedLastIndexBy(array, value, iteratee2) {
            return baseSortedIndexBy(array, value, getIteratee(iteratee2, 2), true);
          }
          function sortedLastIndexOf(array, value) {
            var length = array == null ? 0 : array.length;
            if (length) {
              var index = baseSortedIndex(array, value, true) - 1;
              if (eq(array[index], value)) {
                return index;
              }
            }
            return -1;
          }
          function sortedUniq(array) {
            return array && array.length ? baseSortedUniq(array) : [];
          }
          function sortedUniqBy(array, iteratee2) {
            return array && array.length ? baseSortedUniq(array, getIteratee(iteratee2, 2)) : [];
          }
          function tail(array) {
            var length = array == null ? 0 : array.length;
            return length ? baseSlice(array, 1, length) : [];
          }
          function take(array, n, guard) {
            if (!(array && array.length)) {
              return [];
            }
            n = guard || n === undefined2 ? 1 : toInteger(n);
            return baseSlice(array, 0, n < 0 ? 0 : n);
          }
          function takeRight(array, n, guard) {
            var length = array == null ? 0 : array.length;
            if (!length) {
              return [];
            }
            n = guard || n === undefined2 ? 1 : toInteger(n);
            n = length - n;
            return baseSlice(array, n < 0 ? 0 : n, length);
          }
          function takeRightWhile(array, predicate) {
            return array && array.length ? baseWhile(array, getIteratee(predicate, 3), false, true) : [];
          }
          function takeWhile(array, predicate) {
            return array && array.length ? baseWhile(array, getIteratee(predicate, 3)) : [];
          }
          var union = baseRest(function(arrays) {
            return baseUniq(baseFlatten(arrays, 1, isArrayLikeObject, true));
          });
          var unionBy = baseRest(function(arrays) {
            var iteratee2 = last(arrays);
            if (isArrayLikeObject(iteratee2)) {
              iteratee2 = undefined2;
            }
            return baseUniq(baseFlatten(arrays, 1, isArrayLikeObject, true), getIteratee(iteratee2, 2));
          });
          var unionWith = baseRest(function(arrays) {
            var comparator = last(arrays);
            comparator = typeof comparator == "function" ? comparator : undefined2;
            return baseUniq(baseFlatten(arrays, 1, isArrayLikeObject, true), undefined2, comparator);
          });
          function uniq(array) {
            return array && array.length ? baseUniq(array) : [];
          }
          function uniqBy(array, iteratee2) {
            return array && array.length ? baseUniq(array, getIteratee(iteratee2, 2)) : [];
          }
          function uniqWith(array, comparator) {
            comparator = typeof comparator == "function" ? comparator : undefined2;
            return array && array.length ? baseUniq(array, undefined2, comparator) : [];
          }
          function unzip(array) {
            if (!(array && array.length)) {
              return [];
            }
            var length = 0;
            array = arrayFilter(array, function(group) {
              if (isArrayLikeObject(group)) {
                length = nativeMax(group.length, length);
                return true;
              }
            });
            return baseTimes(length, function(index) {
              return arrayMap(array, baseProperty(index));
            });
          }
          function unzipWith(array, iteratee2) {
            if (!(array && array.length)) {
              return [];
            }
            var result4 = unzip(array);
            if (iteratee2 == null) {
              return result4;
            }
            return arrayMap(result4, function(group) {
              return apply(iteratee2, undefined2, group);
            });
          }
          var without = baseRest(function(array, values2) {
            return isArrayLikeObject(array) ? baseDifference(array, values2) : [];
          });
          var xor = baseRest(function(arrays) {
            return baseXor(arrayFilter(arrays, isArrayLikeObject));
          });
          var xorBy = baseRest(function(arrays) {
            var iteratee2 = last(arrays);
            if (isArrayLikeObject(iteratee2)) {
              iteratee2 = undefined2;
            }
            return baseXor(arrayFilter(arrays, isArrayLikeObject), getIteratee(iteratee2, 2));
          });
          var xorWith = baseRest(function(arrays) {
            var comparator = last(arrays);
            comparator = typeof comparator == "function" ? comparator : undefined2;
            return baseXor(arrayFilter(arrays, isArrayLikeObject), undefined2, comparator);
          });
          var zip = baseRest(unzip);
          function zipObject(props, values2) {
            return baseZipObject(props || [], values2 || [], assignValue);
          }
          function zipObjectDeep(props, values2) {
            return baseZipObject(props || [], values2 || [], baseSet);
          }
          var zipWith = baseRest(function(arrays) {
            var length = arrays.length, iteratee2 = length > 1 ? arrays[length - 1] : undefined2;
            iteratee2 = typeof iteratee2 == "function" ? (arrays.pop(), iteratee2) : undefined2;
            return unzipWith(arrays, iteratee2);
          });
          function chain(value) {
            var result4 = lodash(value);
            result4.__chain__ = true;
            return result4;
          }
          function tap(value, interceptor) {
            interceptor(value);
            return value;
          }
          function thru(value, interceptor) {
            return interceptor(value);
          }
          var wrapperAt = flatRest(function(paths) {
            var length = paths.length, start2 = length ? paths[0] : 0, value = this.__wrapped__, interceptor = function(object2) {
              return baseAt(object2, paths);
            };
            if (length > 1 || this.__actions__.length || !(value instanceof LazyWrapper) || !isIndex(start2)) {
              return this.thru(interceptor);
            }
            value = value.slice(start2, +start2 + (length ? 1 : 0));
            value.__actions__.push({
              "func": thru,
              "args": [interceptor],
              "thisArg": undefined2
            });
            return new LodashWrapper(value, this.__chain__).thru(function(array) {
              if (length && !array.length) {
                array.push(undefined2);
              }
              return array;
            });
          });
          function wrapperChain() {
            return chain(this);
          }
          function wrapperCommit() {
            return new LodashWrapper(this.value(), this.__chain__);
          }
          function wrapperNext() {
            if (this.__values__ === undefined2) {
              this.__values__ = toArray(this.value());
            }
            var done = this.__index__ >= this.__values__.length, value = done ? undefined2 : this.__values__[this.__index__++];
            return { "done": done, "value": value };
          }
          function wrapperToIterator() {
            return this;
          }
          function wrapperPlant(value) {
            var result4, parent2 = this;
            while (parent2 instanceof baseLodash) {
              var clone3 = wrapperClone(parent2);
              clone3.__index__ = 0;
              clone3.__values__ = undefined2;
              if (result4) {
                previous.__wrapped__ = clone3;
              } else {
                result4 = clone3;
              }
              var previous = clone3;
              parent2 = parent2.__wrapped__;
            }
            previous.__wrapped__ = value;
            return result4;
          }
          function wrapperReverse() {
            var value = this.__wrapped__;
            if (value instanceof LazyWrapper) {
              var wrapped = value;
              if (this.__actions__.length) {
                wrapped = new LazyWrapper(this);
              }
              wrapped = wrapped.reverse();
              wrapped.__actions__.push({
                "func": thru,
                "args": [reverse],
                "thisArg": undefined2
              });
              return new LodashWrapper(wrapped, this.__chain__);
            }
            return this.thru(reverse);
          }
          function wrapperValue() {
            return baseWrapperValue(this.__wrapped__, this.__actions__);
          }
          var countBy = createAggregator(function(result4, value, key) {
            if (hasOwnProperty.call(result4, key)) {
              ++result4[key];
            } else {
              baseAssignValue(result4, key, 1);
            }
          });
          function every(collection, predicate, guard) {
            var func = isArray(collection) ? arrayEvery : baseEvery;
            if (guard && isIterateeCall(collection, predicate, guard)) {
              predicate = undefined2;
            }
            return func(collection, getIteratee(predicate, 3));
          }
          function filter(collection, predicate) {
            var func = isArray(collection) ? arrayFilter : baseFilter;
            return func(collection, getIteratee(predicate, 3));
          }
          var find = createFind(findIndex);
          var findLast = createFind(findLastIndex);
          function flatMap(collection, iteratee2) {
            return baseFlatten(map(collection, iteratee2), 1);
          }
          function flatMapDeep(collection, iteratee2) {
            return baseFlatten(map(collection, iteratee2), INFINITY);
          }
          function flatMapDepth(collection, iteratee2, depth) {
            depth = depth === undefined2 ? 1 : toInteger(depth);
            return baseFlatten(map(collection, iteratee2), depth);
          }
          function forEach(collection, iteratee2) {
            var func = isArray(collection) ? arrayEach : baseEach;
            return func(collection, getIteratee(iteratee2, 3));
          }
          function forEachRight(collection, iteratee2) {
            var func = isArray(collection) ? arrayEachRight : baseEachRight;
            return func(collection, getIteratee(iteratee2, 3));
          }
          var groupBy = createAggregator(function(result4, value, key) {
            if (hasOwnProperty.call(result4, key)) {
              result4[key].push(value);
            } else {
              baseAssignValue(result4, key, [value]);
            }
          });
          function includes(collection, value, fromIndex, guard) {
            collection = isArrayLike(collection) ? collection : values(collection);
            fromIndex = fromIndex && !guard ? toInteger(fromIndex) : 0;
            var length = collection.length;
            if (fromIndex < 0) {
              fromIndex = nativeMax(length + fromIndex, 0);
            }
            return isString(collection) ? fromIndex <= length && collection.indexOf(value, fromIndex) > -1 : !!length && baseIndexOf(collection, value, fromIndex) > -1;
          }
          var invokeMap = baseRest(function(collection, path, args) {
            var index = -1, isFunc = typeof path == "function", result4 = isArrayLike(collection) ? Array2(collection.length) : [];
            baseEach(collection, function(value) {
              result4[++index] = isFunc ? apply(path, value, args) : baseInvoke(value, path, args);
            });
            return result4;
          });
          var keyBy = createAggregator(function(result4, value, key) {
            baseAssignValue(result4, key, value);
          });
          function map(collection, iteratee2) {
            var func = isArray(collection) ? arrayMap : baseMap;
            return func(collection, getIteratee(iteratee2, 3));
          }
          function orderBy(collection, iteratees, orders, guard) {
            if (collection == null) {
              return [];
            }
            if (!isArray(iteratees)) {
              iteratees = iteratees == null ? [] : [iteratees];
            }
            orders = guard ? undefined2 : orders;
            if (!isArray(orders)) {
              orders = orders == null ? [] : [orders];
            }
            return baseOrderBy(collection, iteratees, orders);
          }
          var partition = createAggregator(function(result4, value, key) {
            result4[key ? 0 : 1].push(value);
          }, function() {
            return [[], []];
          });
          function reduce(collection, iteratee2, accumulator) {
            var func = isArray(collection) ? arrayReduce : baseReduce, initAccum = arguments.length < 3;
            return func(collection, getIteratee(iteratee2, 4), accumulator, initAccum, baseEach);
          }
          function reduceRight(collection, iteratee2, accumulator) {
            var func = isArray(collection) ? arrayReduceRight : baseReduce, initAccum = arguments.length < 3;
            return func(collection, getIteratee(iteratee2, 4), accumulator, initAccum, baseEachRight);
          }
          function reject(collection, predicate) {
            var func = isArray(collection) ? arrayFilter : baseFilter;
            return func(collection, negate(getIteratee(predicate, 3)));
          }
          function sample(collection) {
            var func = isArray(collection) ? arraySample : baseSample;
            return func(collection);
          }
          function sampleSize(collection, n, guard) {
            if (guard ? isIterateeCall(collection, n, guard) : n === undefined2) {
              n = 1;
            } else {
              n = toInteger(n);
            }
            var func = isArray(collection) ? arraySampleSize : baseSampleSize;
            return func(collection, n);
          }
          function shuffle(collection) {
            var func = isArray(collection) ? arrayShuffle : baseShuffle;
            return func(collection);
          }
          function size(collection) {
            if (collection == null) {
              return 0;
            }
            if (isArrayLike(collection)) {
              return isString(collection) ? stringSize(collection) : collection.length;
            }
            var tag = getTag(collection);
            if (tag == mapTag || tag == setTag) {
              return collection.size;
            }
            return baseKeys(collection).length;
          }
          function some(collection, predicate, guard) {
            var func = isArray(collection) ? arraySome : baseSome;
            if (guard && isIterateeCall(collection, predicate, guard)) {
              predicate = undefined2;
            }
            return func(collection, getIteratee(predicate, 3));
          }
          var sortBy = baseRest(function(collection, iteratees) {
            if (collection == null) {
              return [];
            }
            var length = iteratees.length;
            if (length > 1 && isIterateeCall(collection, iteratees[0], iteratees[1])) {
              iteratees = [];
            } else if (length > 2 && isIterateeCall(iteratees[0], iteratees[1], iteratees[2])) {
              iteratees = [iteratees[0]];
            }
            return baseOrderBy(collection, baseFlatten(iteratees, 1), []);
          });
          var now = ctxNow || function() {
            return root.Date.now();
          };
          function after(n, func) {
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            n = toInteger(n);
            return function() {
              if (--n < 1) {
                return func.apply(this, arguments);
              }
            };
          }
          function ary(func, n, guard) {
            n = guard ? undefined2 : n;
            n = func && n == null ? func.length : n;
            return createWrap(func, WRAP_ARY_FLAG, undefined2, undefined2, undefined2, undefined2, n);
          }
          function before(n, func) {
            var result4;
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            n = toInteger(n);
            return function() {
              if (--n > 0) {
                result4 = func.apply(this, arguments);
              }
              if (n <= 1) {
                func = undefined2;
              }
              return result4;
            };
          }
          var bind = baseRest(function(func, thisArg, partials) {
            var bitmask = WRAP_BIND_FLAG;
            if (partials.length) {
              var holders = replaceHolders(partials, getHolder(bind));
              bitmask |= WRAP_PARTIAL_FLAG;
            }
            return createWrap(func, bitmask, thisArg, partials, holders);
          });
          var bindKey = baseRest(function(object2, key, partials) {
            var bitmask = WRAP_BIND_FLAG | WRAP_BIND_KEY_FLAG;
            if (partials.length) {
              var holders = replaceHolders(partials, getHolder(bindKey));
              bitmask |= WRAP_PARTIAL_FLAG;
            }
            return createWrap(key, bitmask, object2, partials, holders);
          });
          function curry(func, arity, guard) {
            arity = guard ? undefined2 : arity;
            var result4 = createWrap(func, WRAP_CURRY_FLAG, undefined2, undefined2, undefined2, undefined2, undefined2, arity);
            result4.placeholder = curry.placeholder;
            return result4;
          }
          function curryRight(func, arity, guard) {
            arity = guard ? undefined2 : arity;
            var result4 = createWrap(func, WRAP_CURRY_RIGHT_FLAG, undefined2, undefined2, undefined2, undefined2, undefined2, arity);
            result4.placeholder = curryRight.placeholder;
            return result4;
          }
          function debounce(func, wait, options) {
            var lastArgs, lastThis, maxWait, result4, timerId, lastCallTime, lastInvokeTime = 0, leading = false, maxing = false, trailing = true;
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            wait = toNumber(wait) || 0;
            if (isObject(options)) {
              leading = !!options.leading;
              maxing = "maxWait" in options;
              maxWait = maxing ? nativeMax(toNumber(options.maxWait) || 0, wait) : maxWait;
              trailing = "trailing" in options ? !!options.trailing : trailing;
            }
            function invokeFunc(time) {
              var args = lastArgs, thisArg = lastThis;
              lastArgs = lastThis = undefined2;
              lastInvokeTime = time;
              result4 = func.apply(thisArg, args);
              return result4;
            }
            function leadingEdge(time) {
              lastInvokeTime = time;
              timerId = setTimeout2(timerExpired, wait);
              return leading ? invokeFunc(time) : result4;
            }
            function remainingWait(time) {
              var timeSinceLastCall = time - lastCallTime, timeSinceLastInvoke = time - lastInvokeTime, timeWaiting = wait - timeSinceLastCall;
              return maxing ? nativeMin(timeWaiting, maxWait - timeSinceLastInvoke) : timeWaiting;
            }
            function shouldInvoke(time) {
              var timeSinceLastCall = time - lastCallTime, timeSinceLastInvoke = time - lastInvokeTime;
              return lastCallTime === undefined2 || timeSinceLastCall >= wait || timeSinceLastCall < 0 || maxing && timeSinceLastInvoke >= maxWait;
            }
            function timerExpired() {
              var time = now();
              if (shouldInvoke(time)) {
                return trailingEdge(time);
              }
              timerId = setTimeout2(timerExpired, remainingWait(time));
            }
            function trailingEdge(time) {
              timerId = undefined2;
              if (trailing && lastArgs) {
                return invokeFunc(time);
              }
              lastArgs = lastThis = undefined2;
              return result4;
            }
            function cancel() {
              if (timerId !== undefined2) {
                clearTimeout2(timerId);
              }
              lastInvokeTime = 0;
              lastArgs = lastCallTime = lastThis = timerId = undefined2;
            }
            function flush() {
              return timerId === undefined2 ? result4 : trailingEdge(now());
            }
            function debounced() {
              var time = now(), isInvoking = shouldInvoke(time);
              lastArgs = arguments;
              lastThis = this;
              lastCallTime = time;
              if (isInvoking) {
                if (timerId === undefined2) {
                  return leadingEdge(lastCallTime);
                }
                if (maxing) {
                  clearTimeout2(timerId);
                  timerId = setTimeout2(timerExpired, wait);
                  return invokeFunc(lastCallTime);
                }
              }
              if (timerId === undefined2) {
                timerId = setTimeout2(timerExpired, wait);
              }
              return result4;
            }
            debounced.cancel = cancel;
            debounced.flush = flush;
            return debounced;
          }
          var defer2 = baseRest(function(func, args) {
            return baseDelay(func, 1, args);
          });
          var delay = baseRest(function(func, wait, args) {
            return baseDelay(func, toNumber(wait) || 0, args);
          });
          function flip(func) {
            return createWrap(func, WRAP_FLIP_FLAG);
          }
          function memoize(func, resolver) {
            if (typeof func != "function" || resolver != null && typeof resolver != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            var memoized = function() {
              var args = arguments, key = resolver ? resolver.apply(this, args) : args[0], cache = memoized.cache;
              if (cache.has(key)) {
                return cache.get(key);
              }
              var result4 = func.apply(this, args);
              memoized.cache = cache.set(key, result4) || cache;
              return result4;
            };
            memoized.cache = new (memoize.Cache || MapCache)();
            return memoized;
          }
          memoize.Cache = MapCache;
          function negate(predicate) {
            if (typeof predicate != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            return function() {
              var args = arguments;
              switch (args.length) {
                case 0:
                  return !predicate.call(this);
                case 1:
                  return !predicate.call(this, args[0]);
                case 2:
                  return !predicate.call(this, args[0], args[1]);
                case 3:
                  return !predicate.call(this, args[0], args[1], args[2]);
              }
              return !predicate.apply(this, args);
            };
          }
          function once(func) {
            return before(2, func);
          }
          var overArgs = castRest(function(func, transforms) {
            transforms = transforms.length == 1 && isArray(transforms[0]) ? arrayMap(transforms[0], baseUnary(getIteratee())) : arrayMap(baseFlatten(transforms, 1), baseUnary(getIteratee()));
            var funcsLength = transforms.length;
            return baseRest(function(args) {
              var index = -1, length = nativeMin(args.length, funcsLength);
              while (++index < length) {
                args[index] = transforms[index].call(this, args[index]);
              }
              return apply(func, this, args);
            });
          });
          var partial = baseRest(function(func, partials) {
            var holders = replaceHolders(partials, getHolder(partial));
            return createWrap(func, WRAP_PARTIAL_FLAG, undefined2, partials, holders);
          });
          var partialRight = baseRest(function(func, partials) {
            var holders = replaceHolders(partials, getHolder(partialRight));
            return createWrap(func, WRAP_PARTIAL_RIGHT_FLAG, undefined2, partials, holders);
          });
          var rearg = flatRest(function(func, indexes) {
            return createWrap(func, WRAP_REARG_FLAG, undefined2, undefined2, undefined2, indexes);
          });
          function rest(func, start2) {
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            start2 = start2 === undefined2 ? start2 : toInteger(start2);
            return baseRest(func, start2);
          }
          function spread(func, start2) {
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            start2 = start2 == null ? 0 : nativeMax(toInteger(start2), 0);
            return baseRest(function(args) {
              var array = args[start2], otherArgs = castSlice(args, 0, start2);
              if (array) {
                arrayPush(otherArgs, array);
              }
              return apply(func, this, otherArgs);
            });
          }
          function throttle(func, wait, options) {
            var leading = true, trailing = true;
            if (typeof func != "function") {
              throw new TypeError2(FUNC_ERROR_TEXT);
            }
            if (isObject(options)) {
              leading = "leading" in options ? !!options.leading : leading;
              trailing = "trailing" in options ? !!options.trailing : trailing;
            }
            return debounce(func, wait, {
              "leading": leading,
              "maxWait": wait,
              "trailing": trailing
            });
          }
          function unary(func) {
            return ary(func, 1);
          }
          function wrap(value, wrapper) {
            return partial(castFunction(wrapper), value);
          }
          function castArray() {
            if (!arguments.length) {
              return [];
            }
            var value = arguments[0];
            return isArray(value) ? value : [value];
          }
          function clone2(value) {
            return baseClone(value, CLONE_SYMBOLS_FLAG);
          }
          function cloneWith(value, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            return baseClone(value, CLONE_SYMBOLS_FLAG, customizer);
          }
          function cloneDeep(value) {
            return baseClone(value, CLONE_DEEP_FLAG | CLONE_SYMBOLS_FLAG);
          }
          function cloneDeepWith(value, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            return baseClone(value, CLONE_DEEP_FLAG | CLONE_SYMBOLS_FLAG, customizer);
          }
          function conformsTo(object2, source) {
            return source == null || baseConformsTo(object2, source, keys(source));
          }
          function eq(value, other) {
            return value === other || value !== value && other !== other;
          }
          var gt = createRelationalOperation(baseGt);
          var gte = createRelationalOperation(function(value, other) {
            return value >= other;
          });
          var isArguments = baseIsArguments(function() {
            return arguments;
          }()) ? baseIsArguments : function(value) {
            return isObjectLike(value) && hasOwnProperty.call(value, "callee") && !propertyIsEnumerable.call(value, "callee");
          };
          var isArray = Array2.isArray;
          var isArrayBuffer = nodeIsArrayBuffer ? baseUnary(nodeIsArrayBuffer) : baseIsArrayBuffer;
          function isArrayLike(value) {
            return value != null && isLength(value.length) && !isFunction(value);
          }
          function isArrayLikeObject(value) {
            return isObjectLike(value) && isArrayLike(value);
          }
          function isBoolean(value) {
            return value === true || value === false || isObjectLike(value) && baseGetTag(value) == boolTag;
          }
          var isBuffer = nativeIsBuffer || stubFalse;
          var isDate = nodeIsDate ? baseUnary(nodeIsDate) : baseIsDate;
          function isElement(value) {
            return isObjectLike(value) && value.nodeType === 1 && !isPlainObject(value);
          }
          function isEmpty(value) {
            if (value == null) {
              return true;
            }
            if (isArrayLike(value) && (isArray(value) || typeof value == "string" || typeof value.splice == "function" || isBuffer(value) || isTypedArray(value) || isArguments(value))) {
              return !value.length;
            }
            var tag = getTag(value);
            if (tag == mapTag || tag == setTag) {
              return !value.size;
            }
            if (isPrototype(value)) {
              return !baseKeys(value).length;
            }
            for (var key in value) {
              if (hasOwnProperty.call(value, key)) {
                return false;
              }
            }
            return true;
          }
          function isEqual2(value, other) {
            return baseIsEqual(value, other);
          }
          function isEqualWith(value, other, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            var result4 = customizer ? customizer(value, other) : undefined2;
            return result4 === undefined2 ? baseIsEqual(value, other, undefined2, customizer) : !!result4;
          }
          function isError(value) {
            if (!isObjectLike(value)) {
              return false;
            }
            var tag = baseGetTag(value);
            return tag == errorTag || tag == domExcTag || typeof value.message == "string" && typeof value.name == "string" && !isPlainObject(value);
          }
          function isFinite(value) {
            return typeof value == "number" && nativeIsFinite(value);
          }
          function isFunction(value) {
            if (!isObject(value)) {
              return false;
            }
            var tag = baseGetTag(value);
            return tag == funcTag || tag == genTag || tag == asyncTag || tag == proxyTag;
          }
          function isInteger(value) {
            return typeof value == "number" && value == toInteger(value);
          }
          function isLength(value) {
            return typeof value == "number" && value > -1 && value % 1 == 0 && value <= MAX_SAFE_INTEGER;
          }
          function isObject(value) {
            var type = typeof value;
            return value != null && (type == "object" || type == "function");
          }
          function isObjectLike(value) {
            return value != null && typeof value == "object";
          }
          var isMap = nodeIsMap ? baseUnary(nodeIsMap) : baseIsMap;
          function isMatch(object2, source) {
            return object2 === source || baseIsMatch(object2, source, getMatchData(source));
          }
          function isMatchWith(object2, source, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            return baseIsMatch(object2, source, getMatchData(source), customizer);
          }
          function isNaN2(value) {
            return isNumber(value) && value != +value;
          }
          function isNative(value) {
            if (isMaskable(value)) {
              throw new Error2(CORE_ERROR_TEXT);
            }
            return baseIsNative(value);
          }
          function isNull(value) {
            return value === null;
          }
          function isNil(value) {
            return value == null;
          }
          function isNumber(value) {
            return typeof value == "number" || isObjectLike(value) && baseGetTag(value) == numberTag;
          }
          function isPlainObject(value) {
            if (!isObjectLike(value) || baseGetTag(value) != objectTag) {
              return false;
            }
            var proto = getPrototype(value);
            if (proto === null) {
              return true;
            }
            var Ctor = hasOwnProperty.call(proto, "constructor") && proto.constructor;
            return typeof Ctor == "function" && Ctor instanceof Ctor && funcToString.call(Ctor) == objectCtorString;
          }
          var isRegExp = nodeIsRegExp ? baseUnary(nodeIsRegExp) : baseIsRegExp;
          function isSafeInteger(value) {
            return isInteger(value) && value >= -MAX_SAFE_INTEGER && value <= MAX_SAFE_INTEGER;
          }
          var isSet = nodeIsSet ? baseUnary(nodeIsSet) : baseIsSet;
          function isString(value) {
            return typeof value == "string" || !isArray(value) && isObjectLike(value) && baseGetTag(value) == stringTag;
          }
          function isSymbol(value) {
            return typeof value == "symbol" || isObjectLike(value) && baseGetTag(value) == symbolTag;
          }
          var isTypedArray = nodeIsTypedArray ? baseUnary(nodeIsTypedArray) : baseIsTypedArray;
          function isUndefined(value) {
            return value === undefined2;
          }
          function isWeakMap(value) {
            return isObjectLike(value) && getTag(value) == weakMapTag;
          }
          function isWeakSet(value) {
            return isObjectLike(value) && baseGetTag(value) == weakSetTag;
          }
          var lt = createRelationalOperation(baseLt);
          var lte = createRelationalOperation(function(value, other) {
            return value <= other;
          });
          function toArray(value) {
            if (!value) {
              return [];
            }
            if (isArrayLike(value)) {
              return isString(value) ? stringToArray(value) : copyArray(value);
            }
            if (symIterator && value[symIterator]) {
              return iteratorToArray(value[symIterator]());
            }
            var tag = getTag(value), func = tag == mapTag ? mapToArray : tag == setTag ? setToArray : values;
            return func(value);
          }
          function toFinite(value) {
            if (!value) {
              return value === 0 ? value : 0;
            }
            value = toNumber(value);
            if (value === INFINITY || value === -INFINITY) {
              var sign = value < 0 ? -1 : 1;
              return sign * MAX_INTEGER;
            }
            return value === value ? value : 0;
          }
          function toInteger(value) {
            var result4 = toFinite(value), remainder = result4 % 1;
            return result4 === result4 ? remainder ? result4 - remainder : result4 : 0;
          }
          function toLength(value) {
            return value ? baseClamp(toInteger(value), 0, MAX_ARRAY_LENGTH) : 0;
          }
          function toNumber(value) {
            if (typeof value == "number") {
              return value;
            }
            if (isSymbol(value)) {
              return NAN;
            }
            if (isObject(value)) {
              var other = typeof value.valueOf == "function" ? value.valueOf() : value;
              value = isObject(other) ? other + "" : other;
            }
            if (typeof value != "string") {
              return value === 0 ? value : +value;
            }
            value = baseTrim(value);
            var isBinary = reIsBinary.test(value);
            return isBinary || reIsOctal.test(value) ? freeParseInt(value.slice(2), isBinary ? 2 : 8) : reIsBadHex.test(value) ? NAN : +value;
          }
          function toPlainObject(value) {
            return copyObject(value, keysIn(value));
          }
          function toSafeInteger(value) {
            return value ? baseClamp(toInteger(value), -MAX_SAFE_INTEGER, MAX_SAFE_INTEGER) : value === 0 ? value : 0;
          }
          function toString(value) {
            return value == null ? "" : baseToString(value);
          }
          var assign = createAssigner(function(object2, source) {
            if (isPrototype(source) || isArrayLike(source)) {
              copyObject(source, keys(source), object2);
              return;
            }
            for (var key in source) {
              if (hasOwnProperty.call(source, key)) {
                assignValue(object2, key, source[key]);
              }
            }
          });
          var assignIn = createAssigner(function(object2, source) {
            copyObject(source, keysIn(source), object2);
          });
          var assignInWith = createAssigner(function(object2, source, srcIndex, customizer) {
            copyObject(source, keysIn(source), object2, customizer);
          });
          var assignWith = createAssigner(function(object2, source, srcIndex, customizer) {
            copyObject(source, keys(source), object2, customizer);
          });
          var at = flatRest(baseAt);
          function create(prototype, properties) {
            var result4 = baseCreate(prototype);
            return properties == null ? result4 : baseAssign(result4, properties);
          }
          var defaults = baseRest(function(object2, sources) {
            object2 = Object2(object2);
            var index = -1;
            var length = sources.length;
            var guard = length > 2 ? sources[2] : undefined2;
            if (guard && isIterateeCall(sources[0], sources[1], guard)) {
              length = 1;
            }
            while (++index < length) {
              var source = sources[index];
              var props = keysIn(source);
              var propsIndex = -1;
              var propsLength = props.length;
              while (++propsIndex < propsLength) {
                var key = props[propsIndex];
                var value = object2[key];
                if (value === undefined2 || eq(value, objectProto[key]) && !hasOwnProperty.call(object2, key)) {
                  object2[key] = source[key];
                }
              }
            }
            return object2;
          });
          var defaultsDeep = baseRest(function(args) {
            args.push(undefined2, customDefaultsMerge);
            return apply(mergeWith, undefined2, args);
          });
          function findKey(object2, predicate) {
            return baseFindKey(object2, getIteratee(predicate, 3), baseForOwn);
          }
          function findLastKey(object2, predicate) {
            return baseFindKey(object2, getIteratee(predicate, 3), baseForOwnRight);
          }
          function forIn(object2, iteratee2) {
            return object2 == null ? object2 : baseFor(object2, getIteratee(iteratee2, 3), keysIn);
          }
          function forInRight(object2, iteratee2) {
            return object2 == null ? object2 : baseForRight(object2, getIteratee(iteratee2, 3), keysIn);
          }
          function forOwn(object2, iteratee2) {
            return object2 && baseForOwn(object2, getIteratee(iteratee2, 3));
          }
          function forOwnRight(object2, iteratee2) {
            return object2 && baseForOwnRight(object2, getIteratee(iteratee2, 3));
          }
          function functions(object2) {
            return object2 == null ? [] : baseFunctions(object2, keys(object2));
          }
          function functionsIn(object2) {
            return object2 == null ? [] : baseFunctions(object2, keysIn(object2));
          }
          function get2(object2, path, defaultValue) {
            var result4 = object2 == null ? undefined2 : baseGet(object2, path);
            return result4 === undefined2 ? defaultValue : result4;
          }
          function has2(object2, path) {
            return object2 != null && hasPath(object2, path, baseHas);
          }
          function hasIn(object2, path) {
            return object2 != null && hasPath(object2, path, baseHasIn);
          }
          var invert = createInverter(function(result4, value, key) {
            if (value != null && typeof value.toString != "function") {
              value = nativeObjectToString.call(value);
            }
            result4[value] = key;
          }, constant(identity));
          var invertBy = createInverter(function(result4, value, key) {
            if (value != null && typeof value.toString != "function") {
              value = nativeObjectToString.call(value);
            }
            if (hasOwnProperty.call(result4, value)) {
              result4[value].push(key);
            } else {
              result4[value] = [key];
            }
          }, getIteratee);
          var invoke = baseRest(baseInvoke);
          function keys(object2) {
            return isArrayLike(object2) ? arrayLikeKeys(object2) : baseKeys(object2);
          }
          function keysIn(object2) {
            return isArrayLike(object2) ? arrayLikeKeys(object2, true) : baseKeysIn(object2);
          }
          function mapKeys(object2, iteratee2) {
            var result4 = {};
            iteratee2 = getIteratee(iteratee2, 3);
            baseForOwn(object2, function(value, key, object3) {
              baseAssignValue(result4, iteratee2(value, key, object3), value);
            });
            return result4;
          }
          function mapValues(object2, iteratee2) {
            var result4 = {};
            iteratee2 = getIteratee(iteratee2, 3);
            baseForOwn(object2, function(value, key, object3) {
              baseAssignValue(result4, key, iteratee2(value, key, object3));
            });
            return result4;
          }
          var merge = createAssigner(function(object2, source, srcIndex) {
            baseMerge(object2, source, srcIndex);
          });
          var mergeWith = createAssigner(function(object2, source, srcIndex, customizer) {
            baseMerge(object2, source, srcIndex, customizer);
          });
          var omit = flatRest(function(object2, paths) {
            var result4 = {};
            if (object2 == null) {
              return result4;
            }
            var isDeep = false;
            paths = arrayMap(paths, function(path) {
              path = castPath(path, object2);
              isDeep || (isDeep = path.length > 1);
              return path;
            });
            copyObject(object2, getAllKeysIn(object2), result4);
            if (isDeep) {
              result4 = baseClone(result4, CLONE_DEEP_FLAG | CLONE_FLAT_FLAG | CLONE_SYMBOLS_FLAG, customOmitClone);
            }
            var length = paths.length;
            while (length--) {
              baseUnset(result4, paths[length]);
            }
            return result4;
          });
          function omitBy(object2, predicate) {
            return pickBy(object2, negate(getIteratee(predicate)));
          }
          var pick = flatRest(function(object2, paths) {
            return object2 == null ? {} : basePick(object2, paths);
          });
          function pickBy(object2, predicate) {
            if (object2 == null) {
              return {};
            }
            var props = arrayMap(getAllKeysIn(object2), function(prop) {
              return [prop];
            });
            predicate = getIteratee(predicate);
            return basePickBy(object2, props, function(value, path) {
              return predicate(value, path[0]);
            });
          }
          function result3(object2, path, defaultValue) {
            path = castPath(path, object2);
            var index = -1, length = path.length;
            if (!length) {
              length = 1;
              object2 = undefined2;
            }
            while (++index < length) {
              var value = object2 == null ? undefined2 : object2[toKey(path[index])];
              if (value === undefined2) {
                index = length;
                value = defaultValue;
              }
              object2 = isFunction(value) ? value.call(object2) : value;
            }
            return object2;
          }
          function set(object2, path, value) {
            return object2 == null ? object2 : baseSet(object2, path, value);
          }
          function setWith(object2, path, value, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            return object2 == null ? object2 : baseSet(object2, path, value, customizer);
          }
          var toPairs = createToPairs(keys);
          var toPairsIn = createToPairs(keysIn);
          function transform(object2, iteratee2, accumulator) {
            var isArr = isArray(object2), isArrLike = isArr || isBuffer(object2) || isTypedArray(object2);
            iteratee2 = getIteratee(iteratee2, 4);
            if (accumulator == null) {
              var Ctor = object2 && object2.constructor;
              if (isArrLike) {
                accumulator = isArr ? new Ctor() : [];
              } else if (isObject(object2)) {
                accumulator = isFunction(Ctor) ? baseCreate(getPrototype(object2)) : {};
              } else {
                accumulator = {};
              }
            }
            (isArrLike ? arrayEach : baseForOwn)(object2, function(value, index, object3) {
              return iteratee2(accumulator, value, index, object3);
            });
            return accumulator;
          }
          function unset(object2, path) {
            return object2 == null ? true : baseUnset(object2, path);
          }
          function update(object2, path, updater) {
            return object2 == null ? object2 : baseUpdate(object2, path, castFunction(updater));
          }
          function updateWith(object2, path, updater, customizer) {
            customizer = typeof customizer == "function" ? customizer : undefined2;
            return object2 == null ? object2 : baseUpdate(object2, path, castFunction(updater), customizer);
          }
          function values(object2) {
            return object2 == null ? [] : baseValues(object2, keys(object2));
          }
          function valuesIn(object2) {
            return object2 == null ? [] : baseValues(object2, keysIn(object2));
          }
          function clamp(number, lower, upper) {
            if (upper === undefined2) {
              upper = lower;
              lower = undefined2;
            }
            if (upper !== undefined2) {
              upper = toNumber(upper);
              upper = upper === upper ? upper : 0;
            }
            if (lower !== undefined2) {
              lower = toNumber(lower);
              lower = lower === lower ? lower : 0;
            }
            return baseClamp(toNumber(number), lower, upper);
          }
          function inRange(number, start2, end) {
            start2 = toFinite(start2);
            if (end === undefined2) {
              end = start2;
              start2 = 0;
            } else {
              end = toFinite(end);
            }
            number = toNumber(number);
            return baseInRange(number, start2, end);
          }
          function random(lower, upper, floating) {
            if (floating && typeof floating != "boolean" && isIterateeCall(lower, upper, floating)) {
              upper = floating = undefined2;
            }
            if (floating === undefined2) {
              if (typeof upper == "boolean") {
                floating = upper;
                upper = undefined2;
              } else if (typeof lower == "boolean") {
                floating = lower;
                lower = undefined2;
              }
            }
            if (lower === undefined2 && upper === undefined2) {
              lower = 0;
              upper = 1;
            } else {
              lower = toFinite(lower);
              if (upper === undefined2) {
                upper = lower;
                lower = 0;
              } else {
                upper = toFinite(upper);
              }
            }
            if (lower > upper) {
              var temp = lower;
              lower = upper;
              upper = temp;
            }
            if (floating || lower % 1 || upper % 1) {
              var rand = nativeRandom();
              return nativeMin(lower + rand * (upper - lower + freeParseFloat("1e-" + ((rand + "").length - 1))), upper);
            }
            return baseRandom(lower, upper);
          }
          var camelCase = createCompounder(function(result4, word, index) {
            word = word.toLowerCase();
            return result4 + (index ? capitalize2(word) : word);
          });
          function capitalize2(string) {
            return upperFirst(toString(string).toLowerCase());
          }
          function deburr(string) {
            string = toString(string);
            return string && string.replace(reLatin, deburrLetter).replace(reComboMark, "");
          }
          function endsWith(string, target, position) {
            string = toString(string);
            target = baseToString(target);
            var length = string.length;
            position = position === undefined2 ? length : baseClamp(toInteger(position), 0, length);
            var end = position;
            position -= target.length;
            return position >= 0 && string.slice(position, end) == target;
          }
          function escape2(string) {
            string = toString(string);
            return string && reHasUnescapedHtml.test(string) ? string.replace(reUnescapedHtml, escapeHtmlChar) : string;
          }
          function escapeRegExp(string) {
            string = toString(string);
            return string && reHasRegExpChar.test(string) ? string.replace(reRegExpChar, "\\$&") : string;
          }
          var kebabCase = createCompounder(function(result4, word, index) {
            return result4 + (index ? "-" : "") + word.toLowerCase();
          });
          var lowerCase = createCompounder(function(result4, word, index) {
            return result4 + (index ? " " : "") + word.toLowerCase();
          });
          var lowerFirst = createCaseFirst("toLowerCase");
          function pad(string, length, chars2) {
            string = toString(string);
            length = toInteger(length);
            var strLength = length ? stringSize(string) : 0;
            if (!length || strLength >= length) {
              return string;
            }
            var mid = (length - strLength) / 2;
            return createPadding(nativeFloor(mid), chars2) + string + createPadding(nativeCeil(mid), chars2);
          }
          function padEnd(string, length, chars2) {
            string = toString(string);
            length = toInteger(length);
            var strLength = length ? stringSize(string) : 0;
            return length && strLength < length ? string + createPadding(length - strLength, chars2) : string;
          }
          function padStart(string, length, chars2) {
            string = toString(string);
            length = toInteger(length);
            var strLength = length ? stringSize(string) : 0;
            return length && strLength < length ? createPadding(length - strLength, chars2) + string : string;
          }
          function parseInt2(string, radix, guard) {
            if (guard || radix == null) {
              radix = 0;
            } else if (radix) {
              radix = +radix;
            }
            return nativeParseInt(toString(string).replace(reTrimStart, ""), radix || 0);
          }
          function repeat(string, n, guard) {
            if (guard ? isIterateeCall(string, n, guard) : n === undefined2) {
              n = 1;
            } else {
              n = toInteger(n);
            }
            return baseRepeat(toString(string), n);
          }
          function replace() {
            var args = arguments, string = toString(args[0]);
            return args.length < 3 ? string : string.replace(args[1], args[2]);
          }
          var snakeCase = createCompounder(function(result4, word, index) {
            return result4 + (index ? "_" : "") + word.toLowerCase();
          });
          function split(string, separator, limit) {
            if (limit && typeof limit != "number" && isIterateeCall(string, separator, limit)) {
              separator = limit = undefined2;
            }
            limit = limit === undefined2 ? MAX_ARRAY_LENGTH : limit >>> 0;
            if (!limit) {
              return [];
            }
            string = toString(string);
            if (string && (typeof separator == "string" || separator != null && !isRegExp(separator))) {
              separator = baseToString(separator);
              if (!separator && hasUnicode(string)) {
                return castSlice(stringToArray(string), 0, limit);
              }
            }
            return string.split(separator, limit);
          }
          var startCase = createCompounder(function(result4, word, index) {
            return result4 + (index ? " " : "") + upperFirst(word);
          });
          function startsWith(string, target, position) {
            string = toString(string);
            position = position == null ? 0 : baseClamp(toInteger(position), 0, string.length);
            target = baseToString(target);
            return string.slice(position, position + target.length) == target;
          }
          function template(string, options, guard) {
            var settings = lodash.templateSettings;
            if (guard && isIterateeCall(string, options, guard)) {
              options = undefined2;
            }
            string = toString(string);
            options = assignInWith({}, options, settings, customDefaultsAssignIn);
            var imports = assignInWith({}, options.imports, settings.imports, customDefaultsAssignIn), importsKeys = keys(imports), importsValues = baseValues(imports, importsKeys);
            var isEscaping, isEvaluating, index = 0, interpolate = options.interpolate || reNoMatch, source = "__p += '";
            var reDelimiters = RegExp2(
              (options.escape || reNoMatch).source + "|" + interpolate.source + "|" + (interpolate === reInterpolate ? reEsTemplate : reNoMatch).source + "|" + (options.evaluate || reNoMatch).source + "|$",
              "g"
            );
            var sourceURL = "//# sourceURL=" + (hasOwnProperty.call(options, "sourceURL") ? (options.sourceURL + "").replace(/\s/g, " ") : "lodash.templateSources[" + ++templateCounter + "]") + "\n";
            string.replace(reDelimiters, function(match, escapeValue, interpolateValue, esTemplateValue, evaluateValue, offset) {
              interpolateValue || (interpolateValue = esTemplateValue);
              source += string.slice(index, offset).replace(reUnescapedString, escapeStringChar);
              if (escapeValue) {
                isEscaping = true;
                source += "' +\n__e(" + escapeValue + ") +\n'";
              }
              if (evaluateValue) {
                isEvaluating = true;
                source += "';\n" + evaluateValue + ";\n__p += '";
              }
              if (interpolateValue) {
                source += "' +\n((__t = (" + interpolateValue + ")) == null ? '' : __t) +\n'";
              }
              index = offset + match.length;
              return match;
            });
            source += "';\n";
            var variable = hasOwnProperty.call(options, "variable") && options.variable;
            if (!variable) {
              source = "with (obj) {\n" + source + "\n}\n";
            } else if (reForbiddenIdentifierChars.test(variable)) {
              throw new Error2(INVALID_TEMPL_VAR_ERROR_TEXT);
            }
            source = (isEvaluating ? source.replace(reEmptyStringLeading, "") : source).replace(reEmptyStringMiddle, "$1").replace(reEmptyStringTrailing, "$1;");
            source = "function(" + (variable || "obj") + ") {\n" + (variable ? "" : "obj || (obj = {});\n") + "var __t, __p = ''" + (isEscaping ? ", __e = _.escape" : "") + (isEvaluating ? ", __j = Array.prototype.join;\nfunction print() { __p += __j.call(arguments, '') }\n" : ";\n") + source + "return __p\n}";
            var result4 = attempt(function() {
              return Function2(importsKeys, sourceURL + "return " + source).apply(undefined2, importsValues);
            });
            result4.source = source;
            if (isError(result4)) {
              throw result4;
            }
            return result4;
          }
          function toLower(value) {
            return toString(value).toLowerCase();
          }
          function toUpper(value) {
            return toString(value).toUpperCase();
          }
          function trim(string, chars2, guard) {
            string = toString(string);
            if (string && (guard || chars2 === undefined2)) {
              return baseTrim(string);
            }
            if (!string || !(chars2 = baseToString(chars2))) {
              return string;
            }
            var strSymbols = stringToArray(string), chrSymbols = stringToArray(chars2), start2 = charsStartIndex(strSymbols, chrSymbols), end = charsEndIndex(strSymbols, chrSymbols) + 1;
            return castSlice(strSymbols, start2, end).join("");
          }
          function trimEnd(string, chars2, guard) {
            string = toString(string);
            if (string && (guard || chars2 === undefined2)) {
              return string.slice(0, trimmedEndIndex(string) + 1);
            }
            if (!string || !(chars2 = baseToString(chars2))) {
              return string;
            }
            var strSymbols = stringToArray(string), end = charsEndIndex(strSymbols, stringToArray(chars2)) + 1;
            return castSlice(strSymbols, 0, end).join("");
          }
          function trimStart(string, chars2, guard) {
            string = toString(string);
            if (string && (guard || chars2 === undefined2)) {
              return string.replace(reTrimStart, "");
            }
            if (!string || !(chars2 = baseToString(chars2))) {
              return string;
            }
            var strSymbols = stringToArray(string), start2 = charsStartIndex(strSymbols, stringToArray(chars2));
            return castSlice(strSymbols, start2).join("");
          }
          function truncate(string, options) {
            var length = DEFAULT_TRUNC_LENGTH, omission = DEFAULT_TRUNC_OMISSION;
            if (isObject(options)) {
              var separator = "separator" in options ? options.separator : separator;
              length = "length" in options ? toInteger(options.length) : length;
              omission = "omission" in options ? baseToString(options.omission) : omission;
            }
            string = toString(string);
            var strLength = string.length;
            if (hasUnicode(string)) {
              var strSymbols = stringToArray(string);
              strLength = strSymbols.length;
            }
            if (length >= strLength) {
              return string;
            }
            var end = length - stringSize(omission);
            if (end < 1) {
              return omission;
            }
            var result4 = strSymbols ? castSlice(strSymbols, 0, end).join("") : string.slice(0, end);
            if (separator === undefined2) {
              return result4 + omission;
            }
            if (strSymbols) {
              end += result4.length - end;
            }
            if (isRegExp(separator)) {
              if (string.slice(end).search(separator)) {
                var match, substring = result4;
                if (!separator.global) {
                  separator = RegExp2(separator.source, toString(reFlags.exec(separator)) + "g");
                }
                separator.lastIndex = 0;
                while (match = separator.exec(substring)) {
                  var newEnd = match.index;
                }
                result4 = result4.slice(0, newEnd === undefined2 ? end : newEnd);
              }
            } else if (string.indexOf(baseToString(separator), end) != end) {
              var index = result4.lastIndexOf(separator);
              if (index > -1) {
                result4 = result4.slice(0, index);
              }
            }
            return result4 + omission;
          }
          function unescape(string) {
            string = toString(string);
            return string && reHasEscapedHtml.test(string) ? string.replace(reEscapedHtml, unescapeHtmlChar) : string;
          }
          var upperCase = createCompounder(function(result4, word, index) {
            return result4 + (index ? " " : "") + word.toUpperCase();
          });
          var upperFirst = createCaseFirst("toUpperCase");
          function words(string, pattern, guard) {
            string = toString(string);
            pattern = guard ? undefined2 : pattern;
            if (pattern === undefined2) {
              return hasUnicodeWord(string) ? unicodeWords(string) : asciiWords(string);
            }
            return string.match(pattern) || [];
          }
          var attempt = baseRest(function(func, args) {
            try {
              return apply(func, undefined2, args);
            } catch (e) {
              return isError(e) ? e : new Error2(e);
            }
          });
          var bindAll = flatRest(function(object2, methodNames) {
            arrayEach(methodNames, function(key) {
              key = toKey(key);
              baseAssignValue(object2, key, bind(object2[key], object2));
            });
            return object2;
          });
          function cond(pairs) {
            var length = pairs == null ? 0 : pairs.length, toIteratee = getIteratee();
            pairs = !length ? [] : arrayMap(pairs, function(pair) {
              if (typeof pair[1] != "function") {
                throw new TypeError2(FUNC_ERROR_TEXT);
              }
              return [toIteratee(pair[0]), pair[1]];
            });
            return baseRest(function(args) {
              var index = -1;
              while (++index < length) {
                var pair = pairs[index];
                if (apply(pair[0], this, args)) {
                  return apply(pair[1], this, args);
                }
              }
            });
          }
          function conforms(source) {
            return baseConforms(baseClone(source, CLONE_DEEP_FLAG));
          }
          function constant(value) {
            return function() {
              return value;
            };
          }
          function defaultTo(value, defaultValue) {
            return value == null || value !== value ? defaultValue : value;
          }
          var flow = createFlow();
          var flowRight = createFlow(true);
          function identity(value) {
            return value;
          }
          function iteratee(func) {
            return baseIteratee(typeof func == "function" ? func : baseClone(func, CLONE_DEEP_FLAG));
          }
          function matches(source) {
            return baseMatches(baseClone(source, CLONE_DEEP_FLAG));
          }
          function matchesProperty(path, srcValue) {
            return baseMatchesProperty(path, baseClone(srcValue, CLONE_DEEP_FLAG));
          }
          var method = baseRest(function(path, args) {
            return function(object2) {
              return baseInvoke(object2, path, args);
            };
          });
          var methodOf = baseRest(function(object2, args) {
            return function(path) {
              return baseInvoke(object2, path, args);
            };
          });
          function mixin(object2, source, options) {
            var props = keys(source), methodNames = baseFunctions(source, props);
            if (options == null && !(isObject(source) && (methodNames.length || !props.length))) {
              options = source;
              source = object2;
              object2 = this;
              methodNames = baseFunctions(source, keys(source));
            }
            var chain2 = !(isObject(options) && "chain" in options) || !!options.chain, isFunc = isFunction(object2);
            arrayEach(methodNames, function(methodName) {
              var func = source[methodName];
              object2[methodName] = func;
              if (isFunc) {
                object2.prototype[methodName] = function() {
                  var chainAll = this.__chain__;
                  if (chain2 || chainAll) {
                    var result4 = object2(this.__wrapped__), actions = result4.__actions__ = copyArray(this.__actions__);
                    actions.push({ "func": func, "args": arguments, "thisArg": object2 });
                    result4.__chain__ = chainAll;
                    return result4;
                  }
                  return func.apply(object2, arrayPush([this.value()], arguments));
                };
              }
            });
            return object2;
          }
          function noConflict() {
            if (root._ === this) {
              root._ = oldDash;
            }
            return this;
          }
          function noop2() {
          }
          function nthArg(n) {
            n = toInteger(n);
            return baseRest(function(args) {
              return baseNth(args, n);
            });
          }
          var over = createOver(arrayMap);
          var overEvery = createOver(arrayEvery);
          var overSome = createOver(arraySome);
          function property(path) {
            return isKey(path) ? baseProperty(toKey(path)) : basePropertyDeep(path);
          }
          function propertyOf(object2) {
            return function(path) {
              return object2 == null ? undefined2 : baseGet(object2, path);
            };
          }
          var range = createRange();
          var rangeRight = createRange(true);
          function stubArray() {
            return [];
          }
          function stubFalse() {
            return false;
          }
          function stubObject() {
            return {};
          }
          function stubString() {
            return "";
          }
          function stubTrue() {
            return true;
          }
          function times(n, iteratee2) {
            n = toInteger(n);
            if (n < 1 || n > MAX_SAFE_INTEGER) {
              return [];
            }
            var index = MAX_ARRAY_LENGTH, length = nativeMin(n, MAX_ARRAY_LENGTH);
            iteratee2 = getIteratee(iteratee2);
            n -= MAX_ARRAY_LENGTH;
            var result4 = baseTimes(length, iteratee2);
            while (++index < n) {
              iteratee2(index);
            }
            return result4;
          }
          function toPath(value) {
            if (isArray(value)) {
              return arrayMap(value, toKey);
            }
            return isSymbol(value) ? [value] : copyArray(stringToPath(toString(value)));
          }
          function uniqueId(prefix) {
            var id = ++idCounter;
            return toString(prefix) + id;
          }
          var add = createMathOperation(function(augend, addend) {
            return augend + addend;
          }, 0);
          var ceil = createRound("ceil");
          var divide = createMathOperation(function(dividend, divisor) {
            return dividend / divisor;
          }, 1);
          var floor = createRound("floor");
          function max(array) {
            return array && array.length ? baseExtremum(array, identity, baseGt) : undefined2;
          }
          function maxBy(array, iteratee2) {
            return array && array.length ? baseExtremum(array, getIteratee(iteratee2, 2), baseGt) : undefined2;
          }
          function mean(array) {
            return baseMean(array, identity);
          }
          function meanBy(array, iteratee2) {
            return baseMean(array, getIteratee(iteratee2, 2));
          }
          function min(array) {
            return array && array.length ? baseExtremum(array, identity, baseLt) : undefined2;
          }
          function minBy(array, iteratee2) {
            return array && array.length ? baseExtremum(array, getIteratee(iteratee2, 2), baseLt) : undefined2;
          }
          var multiply = createMathOperation(function(multiplier, multiplicand) {
            return multiplier * multiplicand;
          }, 1);
          var round = createRound("round");
          var subtract = createMathOperation(function(minuend, subtrahend) {
            return minuend - subtrahend;
          }, 0);
          function sum(array) {
            return array && array.length ? baseSum(array, identity) : 0;
          }
          function sumBy(array, iteratee2) {
            return array && array.length ? baseSum(array, getIteratee(iteratee2, 2)) : 0;
          }
          lodash.after = after;
          lodash.ary = ary;
          lodash.assign = assign;
          lodash.assignIn = assignIn;
          lodash.assignInWith = assignInWith;
          lodash.assignWith = assignWith;
          lodash.at = at;
          lodash.before = before;
          lodash.bind = bind;
          lodash.bindAll = bindAll;
          lodash.bindKey = bindKey;
          lodash.castArray = castArray;
          lodash.chain = chain;
          lodash.chunk = chunk;
          lodash.compact = compact;
          lodash.concat = concat;
          lodash.cond = cond;
          lodash.conforms = conforms;
          lodash.constant = constant;
          lodash.countBy = countBy;
          lodash.create = create;
          lodash.curry = curry;
          lodash.curryRight = curryRight;
          lodash.debounce = debounce;
          lodash.defaults = defaults;
          lodash.defaultsDeep = defaultsDeep;
          lodash.defer = defer2;
          lodash.delay = delay;
          lodash.difference = difference2;
          lodash.differenceBy = differenceBy;
          lodash.differenceWith = differenceWith;
          lodash.drop = drop;
          lodash.dropRight = dropRight;
          lodash.dropRightWhile = dropRightWhile;
          lodash.dropWhile = dropWhile;
          lodash.fill = fill;
          lodash.filter = filter;
          lodash.flatMap = flatMap;
          lodash.flatMapDeep = flatMapDeep;
          lodash.flatMapDepth = flatMapDepth;
          lodash.flatten = flatten;
          lodash.flattenDeep = flattenDeep;
          lodash.flattenDepth = flattenDepth;
          lodash.flip = flip;
          lodash.flow = flow;
          lodash.flowRight = flowRight;
          lodash.fromPairs = fromPairs;
          lodash.functions = functions;
          lodash.functionsIn = functionsIn;
          lodash.groupBy = groupBy;
          lodash.initial = initial;
          lodash.intersection = intersection;
          lodash.intersectionBy = intersectionBy;
          lodash.intersectionWith = intersectionWith;
          lodash.invert = invert;
          lodash.invertBy = invertBy;
          lodash.invokeMap = invokeMap;
          lodash.iteratee = iteratee;
          lodash.keyBy = keyBy;
          lodash.keys = keys;
          lodash.keysIn = keysIn;
          lodash.map = map;
          lodash.mapKeys = mapKeys;
          lodash.mapValues = mapValues;
          lodash.matches = matches;
          lodash.matchesProperty = matchesProperty;
          lodash.memoize = memoize;
          lodash.merge = merge;
          lodash.mergeWith = mergeWith;
          lodash.method = method;
          lodash.methodOf = methodOf;
          lodash.mixin = mixin;
          lodash.negate = negate;
          lodash.nthArg = nthArg;
          lodash.omit = omit;
          lodash.omitBy = omitBy;
          lodash.once = once;
          lodash.orderBy = orderBy;
          lodash.over = over;
          lodash.overArgs = overArgs;
          lodash.overEvery = overEvery;
          lodash.overSome = overSome;
          lodash.partial = partial;
          lodash.partialRight = partialRight;
          lodash.partition = partition;
          lodash.pick = pick;
          lodash.pickBy = pickBy;
          lodash.property = property;
          lodash.propertyOf = propertyOf;
          lodash.pull = pull;
          lodash.pullAll = pullAll;
          lodash.pullAllBy = pullAllBy;
          lodash.pullAllWith = pullAllWith;
          lodash.pullAt = pullAt;
          lodash.range = range;
          lodash.rangeRight = rangeRight;
          lodash.rearg = rearg;
          lodash.reject = reject;
          lodash.remove = remove;
          lodash.rest = rest;
          lodash.reverse = reverse;
          lodash.sampleSize = sampleSize;
          lodash.set = set;
          lodash.setWith = setWith;
          lodash.shuffle = shuffle;
          lodash.slice = slice;
          lodash.sortBy = sortBy;
          lodash.sortedUniq = sortedUniq;
          lodash.sortedUniqBy = sortedUniqBy;
          lodash.split = split;
          lodash.spread = spread;
          lodash.tail = tail;
          lodash.take = take;
          lodash.takeRight = takeRight;
          lodash.takeRightWhile = takeRightWhile;
          lodash.takeWhile = takeWhile;
          lodash.tap = tap;
          lodash.throttle = throttle;
          lodash.thru = thru;
          lodash.toArray = toArray;
          lodash.toPairs = toPairs;
          lodash.toPairsIn = toPairsIn;
          lodash.toPath = toPath;
          lodash.toPlainObject = toPlainObject;
          lodash.transform = transform;
          lodash.unary = unary;
          lodash.union = union;
          lodash.unionBy = unionBy;
          lodash.unionWith = unionWith;
          lodash.uniq = uniq;
          lodash.uniqBy = uniqBy;
          lodash.uniqWith = uniqWith;
          lodash.unset = unset;
          lodash.unzip = unzip;
          lodash.unzipWith = unzipWith;
          lodash.update = update;
          lodash.updateWith = updateWith;
          lodash.values = values;
          lodash.valuesIn = valuesIn;
          lodash.without = without;
          lodash.words = words;
          lodash.wrap = wrap;
          lodash.xor = xor;
          lodash.xorBy = xorBy;
          lodash.xorWith = xorWith;
          lodash.zip = zip;
          lodash.zipObject = zipObject;
          lodash.zipObjectDeep = zipObjectDeep;
          lodash.zipWith = zipWith;
          lodash.entries = toPairs;
          lodash.entriesIn = toPairsIn;
          lodash.extend = assignIn;
          lodash.extendWith = assignInWith;
          mixin(lodash, lodash);
          lodash.add = add;
          lodash.attempt = attempt;
          lodash.camelCase = camelCase;
          lodash.capitalize = capitalize2;
          lodash.ceil = ceil;
          lodash.clamp = clamp;
          lodash.clone = clone2;
          lodash.cloneDeep = cloneDeep;
          lodash.cloneDeepWith = cloneDeepWith;
          lodash.cloneWith = cloneWith;
          lodash.conformsTo = conformsTo;
          lodash.deburr = deburr;
          lodash.defaultTo = defaultTo;
          lodash.divide = divide;
          lodash.endsWith = endsWith;
          lodash.eq = eq;
          lodash.escape = escape2;
          lodash.escapeRegExp = escapeRegExp;
          lodash.every = every;
          lodash.find = find;
          lodash.findIndex = findIndex;
          lodash.findKey = findKey;
          lodash.findLast = findLast;
          lodash.findLastIndex = findLastIndex;
          lodash.findLastKey = findLastKey;
          lodash.floor = floor;
          lodash.forEach = forEach;
          lodash.forEachRight = forEachRight;
          lodash.forIn = forIn;
          lodash.forInRight = forInRight;
          lodash.forOwn = forOwn;
          lodash.forOwnRight = forOwnRight;
          lodash.get = get2;
          lodash.gt = gt;
          lodash.gte = gte;
          lodash.has = has2;
          lodash.hasIn = hasIn;
          lodash.head = head;
          lodash.identity = identity;
          lodash.includes = includes;
          lodash.indexOf = indexOf;
          lodash.inRange = inRange;
          lodash.invoke = invoke;
          lodash.isArguments = isArguments;
          lodash.isArray = isArray;
          lodash.isArrayBuffer = isArrayBuffer;
          lodash.isArrayLike = isArrayLike;
          lodash.isArrayLikeObject = isArrayLikeObject;
          lodash.isBoolean = isBoolean;
          lodash.isBuffer = isBuffer;
          lodash.isDate = isDate;
          lodash.isElement = isElement;
          lodash.isEmpty = isEmpty;
          lodash.isEqual = isEqual2;
          lodash.isEqualWith = isEqualWith;
          lodash.isError = isError;
          lodash.isFinite = isFinite;
          lodash.isFunction = isFunction;
          lodash.isInteger = isInteger;
          lodash.isLength = isLength;
          lodash.isMap = isMap;
          lodash.isMatch = isMatch;
          lodash.isMatchWith = isMatchWith;
          lodash.isNaN = isNaN2;
          lodash.isNative = isNative;
          lodash.isNil = isNil;
          lodash.isNull = isNull;
          lodash.isNumber = isNumber;
          lodash.isObject = isObject;
          lodash.isObjectLike = isObjectLike;
          lodash.isPlainObject = isPlainObject;
          lodash.isRegExp = isRegExp;
          lodash.isSafeInteger = isSafeInteger;
          lodash.isSet = isSet;
          lodash.isString = isString;
          lodash.isSymbol = isSymbol;
          lodash.isTypedArray = isTypedArray;
          lodash.isUndefined = isUndefined;
          lodash.isWeakMap = isWeakMap;
          lodash.isWeakSet = isWeakSet;
          lodash.join = join;
          lodash.kebabCase = kebabCase;
          lodash.last = last;
          lodash.lastIndexOf = lastIndexOf;
          lodash.lowerCase = lowerCase;
          lodash.lowerFirst = lowerFirst;
          lodash.lt = lt;
          lodash.lte = lte;
          lodash.max = max;
          lodash.maxBy = maxBy;
          lodash.mean = mean;
          lodash.meanBy = meanBy;
          lodash.min = min;
          lodash.minBy = minBy;
          lodash.stubArray = stubArray;
          lodash.stubFalse = stubFalse;
          lodash.stubObject = stubObject;
          lodash.stubString = stubString;
          lodash.stubTrue = stubTrue;
          lodash.multiply = multiply;
          lodash.nth = nth;
          lodash.noConflict = noConflict;
          lodash.noop = noop2;
          lodash.now = now;
          lodash.pad = pad;
          lodash.padEnd = padEnd;
          lodash.padStart = padStart;
          lodash.parseInt = parseInt2;
          lodash.random = random;
          lodash.reduce = reduce;
          lodash.reduceRight = reduceRight;
          lodash.repeat = repeat;
          lodash.replace = replace;
          lodash.result = result3;
          lodash.round = round;
          lodash.runInContext = runInContext2;
          lodash.sample = sample;
          lodash.size = size;
          lodash.snakeCase = snakeCase;
          lodash.some = some;
          lodash.sortedIndex = sortedIndex;
          lodash.sortedIndexBy = sortedIndexBy;
          lodash.sortedIndexOf = sortedIndexOf;
          lodash.sortedLastIndex = sortedLastIndex;
          lodash.sortedLastIndexBy = sortedLastIndexBy;
          lodash.sortedLastIndexOf = sortedLastIndexOf;
          lodash.startCase = startCase;
          lodash.startsWith = startsWith;
          lodash.subtract = subtract;
          lodash.sum = sum;
          lodash.sumBy = sumBy;
          lodash.template = template;
          lodash.times = times;
          lodash.toFinite = toFinite;
          lodash.toInteger = toInteger;
          lodash.toLength = toLength;
          lodash.toLower = toLower;
          lodash.toNumber = toNumber;
          lodash.toSafeInteger = toSafeInteger;
          lodash.toString = toString;
          lodash.toUpper = toUpper;
          lodash.trim = trim;
          lodash.trimEnd = trimEnd;
          lodash.trimStart = trimStart;
          lodash.truncate = truncate;
          lodash.unescape = unescape;
          lodash.uniqueId = uniqueId;
          lodash.upperCase = upperCase;
          lodash.upperFirst = upperFirst;
          lodash.each = forEach;
          lodash.eachRight = forEachRight;
          lodash.first = head;
          mixin(lodash, function() {
            var source = {};
            baseForOwn(lodash, function(func, methodName) {
              if (!hasOwnProperty.call(lodash.prototype, methodName)) {
                source[methodName] = func;
              }
            });
            return source;
          }(), { "chain": false });
          lodash.VERSION = VERSION;
          arrayEach(["bind", "bindKey", "curry", "curryRight", "partial", "partialRight"], function(methodName) {
            lodash[methodName].placeholder = lodash;
          });
          arrayEach(["drop", "take"], function(methodName, index) {
            LazyWrapper.prototype[methodName] = function(n) {
              n = n === undefined2 ? 1 : nativeMax(toInteger(n), 0);
              var result4 = this.__filtered__ && !index ? new LazyWrapper(this) : this.clone();
              if (result4.__filtered__) {
                result4.__takeCount__ = nativeMin(n, result4.__takeCount__);
              } else {
                result4.__views__.push({
                  "size": nativeMin(n, MAX_ARRAY_LENGTH),
                  "type": methodName + (result4.__dir__ < 0 ? "Right" : "")
                });
              }
              return result4;
            };
            LazyWrapper.prototype[methodName + "Right"] = function(n) {
              return this.reverse()[methodName](n).reverse();
            };
          });
          arrayEach(["filter", "map", "takeWhile"], function(methodName, index) {
            var type = index + 1, isFilter = type == LAZY_FILTER_FLAG || type == LAZY_WHILE_FLAG;
            LazyWrapper.prototype[methodName] = function(iteratee2) {
              var result4 = this.clone();
              result4.__iteratees__.push({
                "iteratee": getIteratee(iteratee2, 3),
                "type": type
              });
              result4.__filtered__ = result4.__filtered__ || isFilter;
              return result4;
            };
          });
          arrayEach(["head", "last"], function(methodName, index) {
            var takeName = "take" + (index ? "Right" : "");
            LazyWrapper.prototype[methodName] = function() {
              return this[takeName](1).value()[0];
            };
          });
          arrayEach(["initial", "tail"], function(methodName, index) {
            var dropName = "drop" + (index ? "" : "Right");
            LazyWrapper.prototype[methodName] = function() {
              return this.__filtered__ ? new LazyWrapper(this) : this[dropName](1);
            };
          });
          LazyWrapper.prototype.compact = function() {
            return this.filter(identity);
          };
          LazyWrapper.prototype.find = function(predicate) {
            return this.filter(predicate).head();
          };
          LazyWrapper.prototype.findLast = function(predicate) {
            return this.reverse().find(predicate);
          };
          LazyWrapper.prototype.invokeMap = baseRest(function(path, args) {
            if (typeof path == "function") {
              return new LazyWrapper(this);
            }
            return this.map(function(value) {
              return baseInvoke(value, path, args);
            });
          });
          LazyWrapper.prototype.reject = function(predicate) {
            return this.filter(negate(getIteratee(predicate)));
          };
          LazyWrapper.prototype.slice = function(start2, end) {
            start2 = toInteger(start2);
            var result4 = this;
            if (result4.__filtered__ && (start2 > 0 || end < 0)) {
              return new LazyWrapper(result4);
            }
            if (start2 < 0) {
              result4 = result4.takeRight(-start2);
            } else if (start2) {
              result4 = result4.drop(start2);
            }
            if (end !== undefined2) {
              end = toInteger(end);
              result4 = end < 0 ? result4.dropRight(-end) : result4.take(end - start2);
            }
            return result4;
          };
          LazyWrapper.prototype.takeRightWhile = function(predicate) {
            return this.reverse().takeWhile(predicate).reverse();
          };
          LazyWrapper.prototype.toArray = function() {
            return this.take(MAX_ARRAY_LENGTH);
          };
          baseForOwn(LazyWrapper.prototype, function(func, methodName) {
            var checkIteratee = /^(?:filter|find|map|reject)|While$/.test(methodName), isTaker = /^(?:head|last)$/.test(methodName), lodashFunc = lodash[isTaker ? "take" + (methodName == "last" ? "Right" : "") : methodName], retUnwrapped = isTaker || /^find/.test(methodName);
            if (!lodashFunc) {
              return;
            }
            lodash.prototype[methodName] = function() {
              var value = this.__wrapped__, args = isTaker ? [1] : arguments, isLazy = value instanceof LazyWrapper, iteratee2 = args[0], useLazy = isLazy || isArray(value);
              var interceptor = function(value2) {
                var result5 = lodashFunc.apply(lodash, arrayPush([value2], args));
                return isTaker && chainAll ? result5[0] : result5;
              };
              if (useLazy && checkIteratee && typeof iteratee2 == "function" && iteratee2.length != 1) {
                isLazy = useLazy = false;
              }
              var chainAll = this.__chain__, isHybrid = !!this.__actions__.length, isUnwrapped = retUnwrapped && !chainAll, onlyLazy = isLazy && !isHybrid;
              if (!retUnwrapped && useLazy) {
                value = onlyLazy ? value : new LazyWrapper(this);
                var result4 = func.apply(value, args);
                result4.__actions__.push({ "func": thru, "args": [interceptor], "thisArg": undefined2 });
                return new LodashWrapper(result4, chainAll);
              }
              if (isUnwrapped && onlyLazy) {
                return func.apply(this, args);
              }
              result4 = this.thru(interceptor);
              return isUnwrapped ? isTaker ? result4.value()[0] : result4.value() : result4;
            };
          });
          arrayEach(["pop", "push", "shift", "sort", "splice", "unshift"], function(methodName) {
            var func = arrayProto[methodName], chainName = /^(?:push|sort|unshift)$/.test(methodName) ? "tap" : "thru", retUnwrapped = /^(?:pop|shift)$/.test(methodName);
            lodash.prototype[methodName] = function() {
              var args = arguments;
              if (retUnwrapped && !this.__chain__) {
                var value = this.value();
                return func.apply(isArray(value) ? value : [], args);
              }
              return this[chainName](function(value2) {
                return func.apply(isArray(value2) ? value2 : [], args);
              });
            };
          });
          baseForOwn(LazyWrapper.prototype, function(func, methodName) {
            var lodashFunc = lodash[methodName];
            if (lodashFunc) {
              var key = lodashFunc.name + "";
              if (!hasOwnProperty.call(realNames, key)) {
                realNames[key] = [];
              }
              realNames[key].push({ "name": methodName, "func": lodashFunc });
            }
          });
          realNames[createHybrid(undefined2, WRAP_BIND_KEY_FLAG).name] = [{
            "name": "wrapper",
            "func": undefined2
          }];
          LazyWrapper.prototype.clone = lazyClone;
          LazyWrapper.prototype.reverse = lazyReverse;
          LazyWrapper.prototype.value = lazyValue;
          lodash.prototype.at = wrapperAt;
          lodash.prototype.chain = wrapperChain;
          lodash.prototype.commit = wrapperCommit;
          lodash.prototype.next = wrapperNext;
          lodash.prototype.plant = wrapperPlant;
          lodash.prototype.reverse = wrapperReverse;
          lodash.prototype.toJSON = lodash.prototype.valueOf = lodash.prototype.value = wrapperValue;
          lodash.prototype.first = lodash.prototype.head;
          if (symIterator) {
            lodash.prototype[symIterator] = wrapperToIterator;
          }
          return lodash;
        };
        var _23 = runInContext();
        if (typeof define == "function" && typeof define.amd == "object" && define.amd) {
          root._ = _23;
          define(function() {
            return _23;
          });
        } else if (freeModule) {
          (freeModule.exports = _23)._ = _23;
          freeExports._ = _23;
        } else {
          root._ = _23;
        }
      }).call(exports);
    }
  });

  // ../../../Users/suzuki/weavelet-canvas/node_modules/diff-match-patch/index.js
  var require_diff_match_patch = __commonJS({
    "../../../Users/suzuki/weavelet-canvas/node_modules/diff-match-patch/index.js"(exports, module) {
      var diff_match_patch2 = function() {
        this.Diff_Timeout = 1;
        this.Diff_EditCost = 4;
        this.Match_Threshold = 0.5;
        this.Match_Distance = 1e3;
        this.Patch_DeleteThreshold = 0.5;
        this.Patch_Margin = 4;
        this.Match_MaxBits = 32;
      };
      var DIFF_DELETE = -1;
      var DIFF_INSERT = 1;
      var DIFF_EQUAL = 0;
      diff_match_patch2.Diff = function(op, text) {
        return [op, text];
      };
      diff_match_patch2.prototype.diff_main = function(text1, text2, opt_checklines, opt_deadline) {
        if (typeof opt_deadline == "undefined") {
          if (this.Diff_Timeout <= 0) {
            opt_deadline = Number.MAX_VALUE;
          } else {
            opt_deadline = new Date().getTime() + this.Diff_Timeout * 1e3;
          }
        }
        var deadline = opt_deadline;
        if (text1 == null || text2 == null) {
          throw new Error("Null input. (diff_main)");
        }
        if (text1 == text2) {
          if (text1) {
            return [new diff_match_patch2.Diff(DIFF_EQUAL, text1)];
          }
          return [];
        }
        if (typeof opt_checklines == "undefined") {
          opt_checklines = true;
        }
        var checklines = opt_checklines;
        var commonlength = this.diff_commonPrefix(text1, text2);
        var commonprefix = text1.substring(0, commonlength);
        text1 = text1.substring(commonlength);
        text2 = text2.substring(commonlength);
        commonlength = this.diff_commonSuffix(text1, text2);
        var commonsuffix = text1.substring(text1.length - commonlength);
        text1 = text1.substring(0, text1.length - commonlength);
        text2 = text2.substring(0, text2.length - commonlength);
        var diffs = this.diff_compute_(text1, text2, checklines, deadline);
        if (commonprefix) {
          diffs.unshift(new diff_match_patch2.Diff(DIFF_EQUAL, commonprefix));
        }
        if (commonsuffix) {
          diffs.push(new diff_match_patch2.Diff(DIFF_EQUAL, commonsuffix));
        }
        this.diff_cleanupMerge(diffs);
        return diffs;
      };
      diff_match_patch2.prototype.diff_compute_ = function(text1, text2, checklines, deadline) {
        var diffs;
        if (!text1) {
          return [new diff_match_patch2.Diff(DIFF_INSERT, text2)];
        }
        if (!text2) {
          return [new diff_match_patch2.Diff(DIFF_DELETE, text1)];
        }
        var longtext = text1.length > text2.length ? text1 : text2;
        var shorttext = text1.length > text2.length ? text2 : text1;
        var i = longtext.indexOf(shorttext);
        if (i != -1) {
          diffs = [
            new diff_match_patch2.Diff(DIFF_INSERT, longtext.substring(0, i)),
            new diff_match_patch2.Diff(DIFF_EQUAL, shorttext),
            new diff_match_patch2.Diff(
              DIFF_INSERT,
              longtext.substring(i + shorttext.length)
            )
          ];
          if (text1.length > text2.length) {
            diffs[0][0] = diffs[2][0] = DIFF_DELETE;
          }
          return diffs;
        }
        if (shorttext.length == 1) {
          return [
            new diff_match_patch2.Diff(DIFF_DELETE, text1),
            new diff_match_patch2.Diff(DIFF_INSERT, text2)
          ];
        }
        var hm = this.diff_halfMatch_(text1, text2);
        if (hm) {
          var text1_a = hm[0];
          var text1_b = hm[1];
          var text2_a = hm[2];
          var text2_b = hm[3];
          var mid_common = hm[4];
          var diffs_a = this.diff_main(text1_a, text2_a, checklines, deadline);
          var diffs_b = this.diff_main(text1_b, text2_b, checklines, deadline);
          return diffs_a.concat(
            [new diff_match_patch2.Diff(DIFF_EQUAL, mid_common)],
            diffs_b
          );
        }
        if (checklines && text1.length > 100 && text2.length > 100) {
          return this.diff_lineMode_(text1, text2, deadline);
        }
        return this.diff_bisect_(text1, text2, deadline);
      };
      diff_match_patch2.prototype.diff_lineMode_ = function(text1, text2, deadline) {
        var a = this.diff_linesToChars_(text1, text2);
        text1 = a.chars1;
        text2 = a.chars2;
        var linearray = a.lineArray;
        var diffs = this.diff_main(text1, text2, false, deadline);
        this.diff_charsToLines_(diffs, linearray);
        this.diff_cleanupSemantic(diffs);
        diffs.push(new diff_match_patch2.Diff(DIFF_EQUAL, ""));
        var pointer = 0;
        var count_delete = 0;
        var count_insert = 0;
        var text_delete = "";
        var text_insert = "";
        while (pointer < diffs.length) {
          switch (diffs[pointer][0]) {
            case DIFF_INSERT:
              count_insert++;
              text_insert += diffs[pointer][1];
              break;
            case DIFF_DELETE:
              count_delete++;
              text_delete += diffs[pointer][1];
              break;
            case DIFF_EQUAL:
              if (count_delete >= 1 && count_insert >= 1) {
                diffs.splice(
                  pointer - count_delete - count_insert,
                  count_delete + count_insert
                );
                pointer = pointer - count_delete - count_insert;
                var subDiff = this.diff_main(text_delete, text_insert, false, deadline);
                for (var j = subDiff.length - 1; j >= 0; j--) {
                  diffs.splice(pointer, 0, subDiff[j]);
                }
                pointer = pointer + subDiff.length;
              }
              count_insert = 0;
              count_delete = 0;
              text_delete = "";
              text_insert = "";
              break;
          }
          pointer++;
        }
        diffs.pop();
        return diffs;
      };
      diff_match_patch2.prototype.diff_bisect_ = function(text1, text2, deadline) {
        var text1_length = text1.length;
        var text2_length = text2.length;
        var max_d = Math.ceil((text1_length + text2_length) / 2);
        var v_offset = max_d;
        var v_length = 2 * max_d;
        var v1 = new Array(v_length);
        var v2 = new Array(v_length);
        for (var x = 0; x < v_length; x++) {
          v1[x] = -1;
          v2[x] = -1;
        }
        v1[v_offset + 1] = 0;
        v2[v_offset + 1] = 0;
        var delta = text1_length - text2_length;
        var front = delta % 2 != 0;
        var k1start = 0;
        var k1end = 0;
        var k2start = 0;
        var k2end = 0;
        for (var d = 0; d < max_d; d++) {
          if (new Date().getTime() > deadline) {
            break;
          }
          for (var k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
            var k1_offset = v_offset + k1;
            var x1;
            if (k1 == -d || k1 != d && v1[k1_offset - 1] < v1[k1_offset + 1]) {
              x1 = v1[k1_offset + 1];
            } else {
              x1 = v1[k1_offset - 1] + 1;
            }
            var y1 = x1 - k1;
            while (x1 < text1_length && y1 < text2_length && text1.charAt(x1) == text2.charAt(y1)) {
              x1++;
              y1++;
            }
            v1[k1_offset] = x1;
            if (x1 > text1_length) {
              k1end += 2;
            } else if (y1 > text2_length) {
              k1start += 2;
            } else if (front) {
              var k2_offset = v_offset + delta - k1;
              if (k2_offset >= 0 && k2_offset < v_length && v2[k2_offset] != -1) {
                var x2 = text1_length - v2[k2_offset];
                if (x1 >= x2) {
                  return this.diff_bisectSplit_(text1, text2, x1, y1, deadline);
                }
              }
            }
          }
          for (var k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
            var k2_offset = v_offset + k2;
            var x2;
            if (k2 == -d || k2 != d && v2[k2_offset - 1] < v2[k2_offset + 1]) {
              x2 = v2[k2_offset + 1];
            } else {
              x2 = v2[k2_offset - 1] + 1;
            }
            var y2 = x2 - k2;
            while (x2 < text1_length && y2 < text2_length && text1.charAt(text1_length - x2 - 1) == text2.charAt(text2_length - y2 - 1)) {
              x2++;
              y2++;
            }
            v2[k2_offset] = x2;
            if (x2 > text1_length) {
              k2end += 2;
            } else if (y2 > text2_length) {
              k2start += 2;
            } else if (!front) {
              var k1_offset = v_offset + delta - k2;
              if (k1_offset >= 0 && k1_offset < v_length && v1[k1_offset] != -1) {
                var x1 = v1[k1_offset];
                var y1 = v_offset + x1 - k1_offset;
                x2 = text1_length - x2;
                if (x1 >= x2) {
                  return this.diff_bisectSplit_(text1, text2, x1, y1, deadline);
                }
              }
            }
          }
        }
        return [
          new diff_match_patch2.Diff(DIFF_DELETE, text1),
          new diff_match_patch2.Diff(DIFF_INSERT, text2)
        ];
      };
      diff_match_patch2.prototype.diff_bisectSplit_ = function(text1, text2, x, y, deadline) {
        var text1a = text1.substring(0, x);
        var text2a = text2.substring(0, y);
        var text1b = text1.substring(x);
        var text2b = text2.substring(y);
        var diffs = this.diff_main(text1a, text2a, false, deadline);
        var diffsb = this.diff_main(text1b, text2b, false, deadline);
        return diffs.concat(diffsb);
      };
      diff_match_patch2.prototype.diff_linesToChars_ = function(text1, text2) {
        var lineArray = [];
        var lineHash = {};
        lineArray[0] = "";
        function diff_linesToCharsMunge_(text) {
          var chars3 = "";
          var lineStart = 0;
          var lineEnd = -1;
          var lineArrayLength = lineArray.length;
          while (lineEnd < text.length - 1) {
            lineEnd = text.indexOf("\n", lineStart);
            if (lineEnd == -1) {
              lineEnd = text.length - 1;
            }
            var line = text.substring(lineStart, lineEnd + 1);
            if (lineHash.hasOwnProperty ? lineHash.hasOwnProperty(line) : lineHash[line] !== void 0) {
              chars3 += String.fromCharCode(lineHash[line]);
            } else {
              if (lineArrayLength == maxLines) {
                line = text.substring(lineStart);
                lineEnd = text.length;
              }
              chars3 += String.fromCharCode(lineArrayLength);
              lineHash[line] = lineArrayLength;
              lineArray[lineArrayLength++] = line;
            }
            lineStart = lineEnd + 1;
          }
          return chars3;
        }
        var maxLines = 4e4;
        var chars1 = diff_linesToCharsMunge_(text1);
        maxLines = 65535;
        var chars2 = diff_linesToCharsMunge_(text2);
        return { chars1, chars2, lineArray };
      };
      diff_match_patch2.prototype.diff_charsToLines_ = function(diffs, lineArray) {
        for (var i = 0; i < diffs.length; i++) {
          var chars2 = diffs[i][1];
          var text = [];
          for (var j = 0; j < chars2.length; j++) {
            text[j] = lineArray[chars2.charCodeAt(j)];
          }
          diffs[i][1] = text.join("");
        }
      };
      diff_match_patch2.prototype.diff_commonPrefix = function(text1, text2) {
        if (!text1 || !text2 || text1.charAt(0) != text2.charAt(0)) {
          return 0;
        }
        var pointermin = 0;
        var pointermax = Math.min(text1.length, text2.length);
        var pointermid = pointermax;
        var pointerstart = 0;
        while (pointermin < pointermid) {
          if (text1.substring(pointerstart, pointermid) == text2.substring(pointerstart, pointermid)) {
            pointermin = pointermid;
            pointerstart = pointermin;
          } else {
            pointermax = pointermid;
          }
          pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
        }
        return pointermid;
      };
      diff_match_patch2.prototype.diff_commonSuffix = function(text1, text2) {
        if (!text1 || !text2 || text1.charAt(text1.length - 1) != text2.charAt(text2.length - 1)) {
          return 0;
        }
        var pointermin = 0;
        var pointermax = Math.min(text1.length, text2.length);
        var pointermid = pointermax;
        var pointerend = 0;
        while (pointermin < pointermid) {
          if (text1.substring(text1.length - pointermid, text1.length - pointerend) == text2.substring(text2.length - pointermid, text2.length - pointerend)) {
            pointermin = pointermid;
            pointerend = pointermin;
          } else {
            pointermax = pointermid;
          }
          pointermid = Math.floor((pointermax - pointermin) / 2 + pointermin);
        }
        return pointermid;
      };
      diff_match_patch2.prototype.diff_commonOverlap_ = function(text1, text2) {
        var text1_length = text1.length;
        var text2_length = text2.length;
        if (text1_length == 0 || text2_length == 0) {
          return 0;
        }
        if (text1_length > text2_length) {
          text1 = text1.substring(text1_length - text2_length);
        } else if (text1_length < text2_length) {
          text2 = text2.substring(0, text1_length);
        }
        var text_length = Math.min(text1_length, text2_length);
        if (text1 == text2) {
          return text_length;
        }
        var best = 0;
        var length = 1;
        while (true) {
          var pattern = text1.substring(text_length - length);
          var found = text2.indexOf(pattern);
          if (found == -1) {
            return best;
          }
          length += found;
          if (found == 0 || text1.substring(text_length - length) == text2.substring(0, length)) {
            best = length;
            length++;
          }
        }
      };
      diff_match_patch2.prototype.diff_halfMatch_ = function(text1, text2) {
        if (this.Diff_Timeout <= 0) {
          return null;
        }
        var longtext = text1.length > text2.length ? text1 : text2;
        var shorttext = text1.length > text2.length ? text2 : text1;
        if (longtext.length < 4 || shorttext.length * 2 < longtext.length) {
          return null;
        }
        var dmp4 = this;
        function diff_halfMatchI_(longtext2, shorttext2, i) {
          var seed = longtext2.substring(i, i + Math.floor(longtext2.length / 4));
          var j = -1;
          var best_common = "";
          var best_longtext_a, best_longtext_b, best_shorttext_a, best_shorttext_b;
          while ((j = shorttext2.indexOf(seed, j + 1)) != -1) {
            var prefixLength = dmp4.diff_commonPrefix(
              longtext2.substring(i),
              shorttext2.substring(j)
            );
            var suffixLength = dmp4.diff_commonSuffix(
              longtext2.substring(0, i),
              shorttext2.substring(0, j)
            );
            if (best_common.length < suffixLength + prefixLength) {
              best_common = shorttext2.substring(j - suffixLength, j) + shorttext2.substring(j, j + prefixLength);
              best_longtext_a = longtext2.substring(0, i - suffixLength);
              best_longtext_b = longtext2.substring(i + prefixLength);
              best_shorttext_a = shorttext2.substring(0, j - suffixLength);
              best_shorttext_b = shorttext2.substring(j + prefixLength);
            }
          }
          if (best_common.length * 2 >= longtext2.length) {
            return [
              best_longtext_a,
              best_longtext_b,
              best_shorttext_a,
              best_shorttext_b,
              best_common
            ];
          } else {
            return null;
          }
        }
        var hm1 = diff_halfMatchI_(
          longtext,
          shorttext,
          Math.ceil(longtext.length / 4)
        );
        var hm2 = diff_halfMatchI_(
          longtext,
          shorttext,
          Math.ceil(longtext.length / 2)
        );
        var hm;
        if (!hm1 && !hm2) {
          return null;
        } else if (!hm2) {
          hm = hm1;
        } else if (!hm1) {
          hm = hm2;
        } else {
          hm = hm1[4].length > hm2[4].length ? hm1 : hm2;
        }
        var text1_a, text1_b, text2_a, text2_b;
        if (text1.length > text2.length) {
          text1_a = hm[0];
          text1_b = hm[1];
          text2_a = hm[2];
          text2_b = hm[3];
        } else {
          text2_a = hm[0];
          text2_b = hm[1];
          text1_a = hm[2];
          text1_b = hm[3];
        }
        var mid_common = hm[4];
        return [text1_a, text1_b, text2_a, text2_b, mid_common];
      };
      diff_match_patch2.prototype.diff_cleanupSemantic = function(diffs) {
        var changes = false;
        var equalities = [];
        var equalitiesLength = 0;
        var lastEquality = null;
        var pointer = 0;
        var length_insertions1 = 0;
        var length_deletions1 = 0;
        var length_insertions2 = 0;
        var length_deletions2 = 0;
        while (pointer < diffs.length) {
          if (diffs[pointer][0] == DIFF_EQUAL) {
            equalities[equalitiesLength++] = pointer;
            length_insertions1 = length_insertions2;
            length_deletions1 = length_deletions2;
            length_insertions2 = 0;
            length_deletions2 = 0;
            lastEquality = diffs[pointer][1];
          } else {
            if (diffs[pointer][0] == DIFF_INSERT) {
              length_insertions2 += diffs[pointer][1].length;
            } else {
              length_deletions2 += diffs[pointer][1].length;
            }
            if (lastEquality && lastEquality.length <= Math.max(length_insertions1, length_deletions1) && lastEquality.length <= Math.max(
              length_insertions2,
              length_deletions2
            )) {
              diffs.splice(
                equalities[equalitiesLength - 1],
                0,
                new diff_match_patch2.Diff(DIFF_DELETE, lastEquality)
              );
              diffs[equalities[equalitiesLength - 1] + 1][0] = DIFF_INSERT;
              equalitiesLength--;
              equalitiesLength--;
              pointer = equalitiesLength > 0 ? equalities[equalitiesLength - 1] : -1;
              length_insertions1 = 0;
              length_deletions1 = 0;
              length_insertions2 = 0;
              length_deletions2 = 0;
              lastEquality = null;
              changes = true;
            }
          }
          pointer++;
        }
        if (changes) {
          this.diff_cleanupMerge(diffs);
        }
        this.diff_cleanupSemanticLossless(diffs);
        pointer = 1;
        while (pointer < diffs.length) {
          if (diffs[pointer - 1][0] == DIFF_DELETE && diffs[pointer][0] == DIFF_INSERT) {
            var deletion = diffs[pointer - 1][1];
            var insertion = diffs[pointer][1];
            var overlap_length1 = this.diff_commonOverlap_(deletion, insertion);
            var overlap_length2 = this.diff_commonOverlap_(insertion, deletion);
            if (overlap_length1 >= overlap_length2) {
              if (overlap_length1 >= deletion.length / 2 || overlap_length1 >= insertion.length / 2) {
                diffs.splice(pointer, 0, new diff_match_patch2.Diff(
                  DIFF_EQUAL,
                  insertion.substring(0, overlap_length1)
                ));
                diffs[pointer - 1][1] = deletion.substring(0, deletion.length - overlap_length1);
                diffs[pointer + 1][1] = insertion.substring(overlap_length1);
                pointer++;
              }
            } else {
              if (overlap_length2 >= deletion.length / 2 || overlap_length2 >= insertion.length / 2) {
                diffs.splice(pointer, 0, new diff_match_patch2.Diff(
                  DIFF_EQUAL,
                  deletion.substring(0, overlap_length2)
                ));
                diffs[pointer - 1][0] = DIFF_INSERT;
                diffs[pointer - 1][1] = insertion.substring(0, insertion.length - overlap_length2);
                diffs[pointer + 1][0] = DIFF_DELETE;
                diffs[pointer + 1][1] = deletion.substring(overlap_length2);
                pointer++;
              }
            }
            pointer++;
          }
          pointer++;
        }
      };
      diff_match_patch2.prototype.diff_cleanupSemanticLossless = function(diffs) {
        function diff_cleanupSemanticScore_(one, two) {
          if (!one || !two) {
            return 6;
          }
          var char1 = one.charAt(one.length - 1);
          var char2 = two.charAt(0);
          var nonAlphaNumeric1 = char1.match(diff_match_patch2.nonAlphaNumericRegex_);
          var nonAlphaNumeric2 = char2.match(diff_match_patch2.nonAlphaNumericRegex_);
          var whitespace1 = nonAlphaNumeric1 && char1.match(diff_match_patch2.whitespaceRegex_);
          var whitespace2 = nonAlphaNumeric2 && char2.match(diff_match_patch2.whitespaceRegex_);
          var lineBreak1 = whitespace1 && char1.match(diff_match_patch2.linebreakRegex_);
          var lineBreak2 = whitespace2 && char2.match(diff_match_patch2.linebreakRegex_);
          var blankLine1 = lineBreak1 && one.match(diff_match_patch2.blanklineEndRegex_);
          var blankLine2 = lineBreak2 && two.match(diff_match_patch2.blanklineStartRegex_);
          if (blankLine1 || blankLine2) {
            return 5;
          } else if (lineBreak1 || lineBreak2) {
            return 4;
          } else if (nonAlphaNumeric1 && !whitespace1 && whitespace2) {
            return 3;
          } else if (whitespace1 || whitespace2) {
            return 2;
          } else if (nonAlphaNumeric1 || nonAlphaNumeric2) {
            return 1;
          }
          return 0;
        }
        var pointer = 1;
        while (pointer < diffs.length - 1) {
          if (diffs[pointer - 1][0] == DIFF_EQUAL && diffs[pointer + 1][0] == DIFF_EQUAL) {
            var equality1 = diffs[pointer - 1][1];
            var edit = diffs[pointer][1];
            var equality2 = diffs[pointer + 1][1];
            var commonOffset = this.diff_commonSuffix(equality1, edit);
            if (commonOffset) {
              var commonString = edit.substring(edit.length - commonOffset);
              equality1 = equality1.substring(0, equality1.length - commonOffset);
              edit = commonString + edit.substring(0, edit.length - commonOffset);
              equality2 = commonString + equality2;
            }
            var bestEquality1 = equality1;
            var bestEdit = edit;
            var bestEquality2 = equality2;
            var bestScore = diff_cleanupSemanticScore_(equality1, edit) + diff_cleanupSemanticScore_(edit, equality2);
            while (edit.charAt(0) === equality2.charAt(0)) {
              equality1 += edit.charAt(0);
              edit = edit.substring(1) + equality2.charAt(0);
              equality2 = equality2.substring(1);
              var score = diff_cleanupSemanticScore_(equality1, edit) + diff_cleanupSemanticScore_(edit, equality2);
              if (score >= bestScore) {
                bestScore = score;
                bestEquality1 = equality1;
                bestEdit = edit;
                bestEquality2 = equality2;
              }
            }
            if (diffs[pointer - 1][1] != bestEquality1) {
              if (bestEquality1) {
                diffs[pointer - 1][1] = bestEquality1;
              } else {
                diffs.splice(pointer - 1, 1);
                pointer--;
              }
              diffs[pointer][1] = bestEdit;
              if (bestEquality2) {
                diffs[pointer + 1][1] = bestEquality2;
              } else {
                diffs.splice(pointer + 1, 1);
                pointer--;
              }
            }
          }
          pointer++;
        }
      };
      diff_match_patch2.nonAlphaNumericRegex_ = /[^a-zA-Z0-9]/;
      diff_match_patch2.whitespaceRegex_ = /\s/;
      diff_match_patch2.linebreakRegex_ = /[\r\n]/;
      diff_match_patch2.blanklineEndRegex_ = /\n\r?\n$/;
      diff_match_patch2.blanklineStartRegex_ = /^\r?\n\r?\n/;
      diff_match_patch2.prototype.diff_cleanupEfficiency = function(diffs) {
        var changes = false;
        var equalities = [];
        var equalitiesLength = 0;
        var lastEquality = null;
        var pointer = 0;
        var pre_ins = false;
        var pre_del = false;
        var post_ins = false;
        var post_del = false;
        while (pointer < diffs.length) {
          if (diffs[pointer][0] == DIFF_EQUAL) {
            if (diffs[pointer][1].length < this.Diff_EditCost && (post_ins || post_del)) {
              equalities[equalitiesLength++] = pointer;
              pre_ins = post_ins;
              pre_del = post_del;
              lastEquality = diffs[pointer][1];
            } else {
              equalitiesLength = 0;
              lastEquality = null;
            }
            post_ins = post_del = false;
          } else {
            if (diffs[pointer][0] == DIFF_DELETE) {
              post_del = true;
            } else {
              post_ins = true;
            }
            if (lastEquality && (pre_ins && pre_del && post_ins && post_del || lastEquality.length < this.Diff_EditCost / 2 && pre_ins + pre_del + post_ins + post_del == 3)) {
              diffs.splice(
                equalities[equalitiesLength - 1],
                0,
                new diff_match_patch2.Diff(DIFF_DELETE, lastEquality)
              );
              diffs[equalities[equalitiesLength - 1] + 1][0] = DIFF_INSERT;
              equalitiesLength--;
              lastEquality = null;
              if (pre_ins && pre_del) {
                post_ins = post_del = true;
                equalitiesLength = 0;
              } else {
                equalitiesLength--;
                pointer = equalitiesLength > 0 ? equalities[equalitiesLength - 1] : -1;
                post_ins = post_del = false;
              }
              changes = true;
            }
          }
          pointer++;
        }
        if (changes) {
          this.diff_cleanupMerge(diffs);
        }
      };
      diff_match_patch2.prototype.diff_cleanupMerge = function(diffs) {
        diffs.push(new diff_match_patch2.Diff(DIFF_EQUAL, ""));
        var pointer = 0;
        var count_delete = 0;
        var count_insert = 0;
        var text_delete = "";
        var text_insert = "";
        var commonlength;
        while (pointer < diffs.length) {
          switch (diffs[pointer][0]) {
            case DIFF_INSERT:
              count_insert++;
              text_insert += diffs[pointer][1];
              pointer++;
              break;
            case DIFF_DELETE:
              count_delete++;
              text_delete += diffs[pointer][1];
              pointer++;
              break;
            case DIFF_EQUAL:
              if (count_delete + count_insert > 1) {
                if (count_delete !== 0 && count_insert !== 0) {
                  commonlength = this.diff_commonPrefix(text_insert, text_delete);
                  if (commonlength !== 0) {
                    if (pointer - count_delete - count_insert > 0 && diffs[pointer - count_delete - count_insert - 1][0] == DIFF_EQUAL) {
                      diffs[pointer - count_delete - count_insert - 1][1] += text_insert.substring(0, commonlength);
                    } else {
                      diffs.splice(0, 0, new diff_match_patch2.Diff(
                        DIFF_EQUAL,
                        text_insert.substring(0, commonlength)
                      ));
                      pointer++;
                    }
                    text_insert = text_insert.substring(commonlength);
                    text_delete = text_delete.substring(commonlength);
                  }
                  commonlength = this.diff_commonSuffix(text_insert, text_delete);
                  if (commonlength !== 0) {
                    diffs[pointer][1] = text_insert.substring(text_insert.length - commonlength) + diffs[pointer][1];
                    text_insert = text_insert.substring(0, text_insert.length - commonlength);
                    text_delete = text_delete.substring(0, text_delete.length - commonlength);
                  }
                }
                pointer -= count_delete + count_insert;
                diffs.splice(pointer, count_delete + count_insert);
                if (text_delete.length) {
                  diffs.splice(
                    pointer,
                    0,
                    new diff_match_patch2.Diff(DIFF_DELETE, text_delete)
                  );
                  pointer++;
                }
                if (text_insert.length) {
                  diffs.splice(
                    pointer,
                    0,
                    new diff_match_patch2.Diff(DIFF_INSERT, text_insert)
                  );
                  pointer++;
                }
                pointer++;
              } else if (pointer !== 0 && diffs[pointer - 1][0] == DIFF_EQUAL) {
                diffs[pointer - 1][1] += diffs[pointer][1];
                diffs.splice(pointer, 1);
              } else {
                pointer++;
              }
              count_insert = 0;
              count_delete = 0;
              text_delete = "";
              text_insert = "";
              break;
          }
        }
        if (diffs[diffs.length - 1][1] === "") {
          diffs.pop();
        }
        var changes = false;
        pointer = 1;
        while (pointer < diffs.length - 1) {
          if (diffs[pointer - 1][0] == DIFF_EQUAL && diffs[pointer + 1][0] == DIFF_EQUAL) {
            if (diffs[pointer][1].substring(diffs[pointer][1].length - diffs[pointer - 1][1].length) == diffs[pointer - 1][1]) {
              diffs[pointer][1] = diffs[pointer - 1][1] + diffs[pointer][1].substring(0, diffs[pointer][1].length - diffs[pointer - 1][1].length);
              diffs[pointer + 1][1] = diffs[pointer - 1][1] + diffs[pointer + 1][1];
              diffs.splice(pointer - 1, 1);
              changes = true;
            } else if (diffs[pointer][1].substring(0, diffs[pointer + 1][1].length) == diffs[pointer + 1][1]) {
              diffs[pointer - 1][1] += diffs[pointer + 1][1];
              diffs[pointer][1] = diffs[pointer][1].substring(diffs[pointer + 1][1].length) + diffs[pointer + 1][1];
              diffs.splice(pointer + 1, 1);
              changes = true;
            }
          }
          pointer++;
        }
        if (changes) {
          this.diff_cleanupMerge(diffs);
        }
      };
      diff_match_patch2.prototype.diff_xIndex = function(diffs, loc) {
        var chars1 = 0;
        var chars2 = 0;
        var last_chars1 = 0;
        var last_chars2 = 0;
        var x;
        for (x = 0; x < diffs.length; x++) {
          if (diffs[x][0] !== DIFF_INSERT) {
            chars1 += diffs[x][1].length;
          }
          if (diffs[x][0] !== DIFF_DELETE) {
            chars2 += diffs[x][1].length;
          }
          if (chars1 > loc) {
            break;
          }
          last_chars1 = chars1;
          last_chars2 = chars2;
        }
        if (diffs.length != x && diffs[x][0] === DIFF_DELETE) {
          return last_chars2;
        }
        return last_chars2 + (loc - last_chars1);
      };
      diff_match_patch2.prototype.diff_prettyHtml = function(diffs) {
        var html = [];
        var pattern_amp = /&/g;
        var pattern_lt = /</g;
        var pattern_gt = />/g;
        var pattern_para = /\n/g;
        for (var x = 0; x < diffs.length; x++) {
          var op = diffs[x][0];
          var data = diffs[x][1];
          var text = data.replace(pattern_amp, "&amp;").replace(pattern_lt, "&lt;").replace(pattern_gt, "&gt;").replace(pattern_para, "&para;<br>");
          switch (op) {
            case DIFF_INSERT:
              html[x] = '<ins style="background:#e6ffe6;">' + text + "</ins>";
              break;
            case DIFF_DELETE:
              html[x] = '<del style="background:#ffe6e6;">' + text + "</del>";
              break;
            case DIFF_EQUAL:
              html[x] = "<span>" + text + "</span>";
              break;
          }
        }
        return html.join("");
      };
      diff_match_patch2.prototype.diff_text1 = function(diffs) {
        var text = [];
        for (var x = 0; x < diffs.length; x++) {
          if (diffs[x][0] !== DIFF_INSERT) {
            text[x] = diffs[x][1];
          }
        }
        return text.join("");
      };
      diff_match_patch2.prototype.diff_text2 = function(diffs) {
        var text = [];
        for (var x = 0; x < diffs.length; x++) {
          if (diffs[x][0] !== DIFF_DELETE) {
            text[x] = diffs[x][1];
          }
        }
        return text.join("");
      };
      diff_match_patch2.prototype.diff_levenshtein = function(diffs) {
        var levenshtein = 0;
        var insertions = 0;
        var deletions = 0;
        for (var x = 0; x < diffs.length; x++) {
          var op = diffs[x][0];
          var data = diffs[x][1];
          switch (op) {
            case DIFF_INSERT:
              insertions += data.length;
              break;
            case DIFF_DELETE:
              deletions += data.length;
              break;
            case DIFF_EQUAL:
              levenshtein += Math.max(insertions, deletions);
              insertions = 0;
              deletions = 0;
              break;
          }
        }
        levenshtein += Math.max(insertions, deletions);
        return levenshtein;
      };
      diff_match_patch2.prototype.diff_toDelta = function(diffs) {
        var text = [];
        for (var x = 0; x < diffs.length; x++) {
          switch (diffs[x][0]) {
            case DIFF_INSERT:
              text[x] = "+" + encodeURI(diffs[x][1]);
              break;
            case DIFF_DELETE:
              text[x] = "-" + diffs[x][1].length;
              break;
            case DIFF_EQUAL:
              text[x] = "=" + diffs[x][1].length;
              break;
          }
        }
        return text.join("	").replace(/%20/g, " ");
      };
      diff_match_patch2.prototype.diff_fromDelta = function(text1, delta) {
        var diffs = [];
        var diffsLength = 0;
        var pointer = 0;
        var tokens = delta.split(/\t/g);
        for (var x = 0; x < tokens.length; x++) {
          var param = tokens[x].substring(1);
          switch (tokens[x].charAt(0)) {
            case "+":
              try {
                diffs[diffsLength++] = new diff_match_patch2.Diff(DIFF_INSERT, decodeURI(param));
              } catch (ex) {
                throw new Error("Illegal escape in diff_fromDelta: " + param);
              }
              break;
            case "-":
            case "=":
              var n = parseInt(param, 10);
              if (isNaN(n) || n < 0) {
                throw new Error("Invalid number in diff_fromDelta: " + param);
              }
              var text = text1.substring(pointer, pointer += n);
              if (tokens[x].charAt(0) == "=") {
                diffs[diffsLength++] = new diff_match_patch2.Diff(DIFF_EQUAL, text);
              } else {
                diffs[diffsLength++] = new diff_match_patch2.Diff(DIFF_DELETE, text);
              }
              break;
            default:
              if (tokens[x]) {
                throw new Error("Invalid diff operation in diff_fromDelta: " + tokens[x]);
              }
          }
        }
        if (pointer != text1.length) {
          throw new Error("Delta length (" + pointer + ") does not equal source text length (" + text1.length + ").");
        }
        return diffs;
      };
      diff_match_patch2.prototype.match_main = function(text, pattern, loc) {
        if (text == null || pattern == null || loc == null) {
          throw new Error("Null input. (match_main)");
        }
        loc = Math.max(0, Math.min(loc, text.length));
        if (text == pattern) {
          return 0;
        } else if (!text.length) {
          return -1;
        } else if (text.substring(loc, loc + pattern.length) == pattern) {
          return loc;
        } else {
          return this.match_bitap_(text, pattern, loc);
        }
      };
      diff_match_patch2.prototype.match_bitap_ = function(text, pattern, loc) {
        if (pattern.length > this.Match_MaxBits) {
          throw new Error("Pattern too long for this browser.");
        }
        var s = this.match_alphabet_(pattern);
        var dmp4 = this;
        function match_bitapScore_(e, x) {
          var accuracy = e / pattern.length;
          var proximity = Math.abs(loc - x);
          if (!dmp4.Match_Distance) {
            return proximity ? 1 : accuracy;
          }
          return accuracy + proximity / dmp4.Match_Distance;
        }
        var score_threshold = this.Match_Threshold;
        var best_loc = text.indexOf(pattern, loc);
        if (best_loc != -1) {
          score_threshold = Math.min(match_bitapScore_(0, best_loc), score_threshold);
          best_loc = text.lastIndexOf(pattern, loc + pattern.length);
          if (best_loc != -1) {
            score_threshold = Math.min(match_bitapScore_(0, best_loc), score_threshold);
          }
        }
        var matchmask = 1 << pattern.length - 1;
        best_loc = -1;
        var bin_min, bin_mid;
        var bin_max = pattern.length + text.length;
        var last_rd;
        for (var d = 0; d < pattern.length; d++) {
          bin_min = 0;
          bin_mid = bin_max;
          while (bin_min < bin_mid) {
            if (match_bitapScore_(d, loc + bin_mid) <= score_threshold) {
              bin_min = bin_mid;
            } else {
              bin_max = bin_mid;
            }
            bin_mid = Math.floor((bin_max - bin_min) / 2 + bin_min);
          }
          bin_max = bin_mid;
          var start2 = Math.max(1, loc - bin_mid + 1);
          var finish = Math.min(loc + bin_mid, text.length) + pattern.length;
          var rd = Array(finish + 2);
          rd[finish + 1] = (1 << d) - 1;
          for (var j = finish; j >= start2; j--) {
            var charMatch = s[text.charAt(j - 1)];
            if (d === 0) {
              rd[j] = (rd[j + 1] << 1 | 1) & charMatch;
            } else {
              rd[j] = (rd[j + 1] << 1 | 1) & charMatch | ((last_rd[j + 1] | last_rd[j]) << 1 | 1) | last_rd[j + 1];
            }
            if (rd[j] & matchmask) {
              var score = match_bitapScore_(d, j - 1);
              if (score <= score_threshold) {
                score_threshold = score;
                best_loc = j - 1;
                if (best_loc > loc) {
                  start2 = Math.max(1, 2 * loc - best_loc);
                } else {
                  break;
                }
              }
            }
          }
          if (match_bitapScore_(d + 1, loc) > score_threshold) {
            break;
          }
          last_rd = rd;
        }
        return best_loc;
      };
      diff_match_patch2.prototype.match_alphabet_ = function(pattern) {
        var s = {};
        for (var i = 0; i < pattern.length; i++) {
          s[pattern.charAt(i)] = 0;
        }
        for (var i = 0; i < pattern.length; i++) {
          s[pattern.charAt(i)] |= 1 << pattern.length - i - 1;
        }
        return s;
      };
      diff_match_patch2.prototype.patch_addContext_ = function(patch, text) {
        if (text.length == 0) {
          return;
        }
        if (patch.start2 === null) {
          throw Error("patch not initialized");
        }
        var pattern = text.substring(patch.start2, patch.start2 + patch.length1);
        var padding = 0;
        while (text.indexOf(pattern) != text.lastIndexOf(pattern) && pattern.length < this.Match_MaxBits - this.Patch_Margin - this.Patch_Margin) {
          padding += this.Patch_Margin;
          pattern = text.substring(
            patch.start2 - padding,
            patch.start2 + patch.length1 + padding
          );
        }
        padding += this.Patch_Margin;
        var prefix = text.substring(patch.start2 - padding, patch.start2);
        if (prefix) {
          patch.diffs.unshift(new diff_match_patch2.Diff(DIFF_EQUAL, prefix));
        }
        var suffix = text.substring(
          patch.start2 + patch.length1,
          patch.start2 + patch.length1 + padding
        );
        if (suffix) {
          patch.diffs.push(new diff_match_patch2.Diff(DIFF_EQUAL, suffix));
        }
        patch.start1 -= prefix.length;
        patch.start2 -= prefix.length;
        patch.length1 += prefix.length + suffix.length;
        patch.length2 += prefix.length + suffix.length;
      };
      diff_match_patch2.prototype.patch_make = function(a, opt_b, opt_c) {
        var text1, diffs;
        if (typeof a == "string" && typeof opt_b == "string" && typeof opt_c == "undefined") {
          text1 = /** @type {string} */
          a;
          diffs = this.diff_main(
            text1,
            /** @type {string} */
            opt_b,
            true
          );
          if (diffs.length > 2) {
            this.diff_cleanupSemantic(diffs);
            this.diff_cleanupEfficiency(diffs);
          }
        } else if (a && typeof a == "object" && typeof opt_b == "undefined" && typeof opt_c == "undefined") {
          diffs = /** @type {!Array.<!diff_match_patch.Diff>} */
          a;
          text1 = this.diff_text1(diffs);
        } else if (typeof a == "string" && opt_b && typeof opt_b == "object" && typeof opt_c == "undefined") {
          text1 = /** @type {string} */
          a;
          diffs = /** @type {!Array.<!diff_match_patch.Diff>} */
          opt_b;
        } else if (typeof a == "string" && typeof opt_b == "string" && opt_c && typeof opt_c == "object") {
          text1 = /** @type {string} */
          a;
          diffs = /** @type {!Array.<!diff_match_patch.Diff>} */
          opt_c;
        } else {
          throw new Error("Unknown call format to patch_make.");
        }
        if (diffs.length === 0) {
          return [];
        }
        var patches = [];
        var patch = new diff_match_patch2.patch_obj();
        var patchDiffLength = 0;
        var char_count1 = 0;
        var char_count2 = 0;
        var prepatch_text = text1;
        var postpatch_text = text1;
        for (var x = 0; x < diffs.length; x++) {
          var diff_type = diffs[x][0];
          var diff_text = diffs[x][1];
          if (!patchDiffLength && diff_type !== DIFF_EQUAL) {
            patch.start1 = char_count1;
            patch.start2 = char_count2;
          }
          switch (diff_type) {
            case DIFF_INSERT:
              patch.diffs[patchDiffLength++] = diffs[x];
              patch.length2 += diff_text.length;
              postpatch_text = postpatch_text.substring(0, char_count2) + diff_text + postpatch_text.substring(char_count2);
              break;
            case DIFF_DELETE:
              patch.length1 += diff_text.length;
              patch.diffs[patchDiffLength++] = diffs[x];
              postpatch_text = postpatch_text.substring(0, char_count2) + postpatch_text.substring(char_count2 + diff_text.length);
              break;
            case DIFF_EQUAL:
              if (diff_text.length <= 2 * this.Patch_Margin && patchDiffLength && diffs.length != x + 1) {
                patch.diffs[patchDiffLength++] = diffs[x];
                patch.length1 += diff_text.length;
                patch.length2 += diff_text.length;
              } else if (diff_text.length >= 2 * this.Patch_Margin) {
                if (patchDiffLength) {
                  this.patch_addContext_(patch, prepatch_text);
                  patches.push(patch);
                  patch = new diff_match_patch2.patch_obj();
                  patchDiffLength = 0;
                  prepatch_text = postpatch_text;
                  char_count1 = char_count2;
                }
              }
              break;
          }
          if (diff_type !== DIFF_INSERT) {
            char_count1 += diff_text.length;
          }
          if (diff_type !== DIFF_DELETE) {
            char_count2 += diff_text.length;
          }
        }
        if (patchDiffLength) {
          this.patch_addContext_(patch, prepatch_text);
          patches.push(patch);
        }
        return patches;
      };
      diff_match_patch2.prototype.patch_deepCopy = function(patches) {
        var patchesCopy = [];
        for (var x = 0; x < patches.length; x++) {
          var patch = patches[x];
          var patchCopy = new diff_match_patch2.patch_obj();
          patchCopy.diffs = [];
          for (var y = 0; y < patch.diffs.length; y++) {
            patchCopy.diffs[y] = new diff_match_patch2.Diff(patch.diffs[y][0], patch.diffs[y][1]);
          }
          patchCopy.start1 = patch.start1;
          patchCopy.start2 = patch.start2;
          patchCopy.length1 = patch.length1;
          patchCopy.length2 = patch.length2;
          patchesCopy[x] = patchCopy;
        }
        return patchesCopy;
      };
      diff_match_patch2.prototype.patch_apply = function(patches, text) {
        if (patches.length == 0) {
          return [text, []];
        }
        patches = this.patch_deepCopy(patches);
        var nullPadding = this.patch_addPadding(patches);
        text = nullPadding + text + nullPadding;
        this.patch_splitMax(patches);
        var delta = 0;
        var results = [];
        for (var x = 0; x < patches.length; x++) {
          var expected_loc = patches[x].start2 + delta;
          var text1 = this.diff_text1(patches[x].diffs);
          var start_loc;
          var end_loc = -1;
          if (text1.length > this.Match_MaxBits) {
            start_loc = this.match_main(
              text,
              text1.substring(0, this.Match_MaxBits),
              expected_loc
            );
            if (start_loc != -1) {
              end_loc = this.match_main(
                text,
                text1.substring(text1.length - this.Match_MaxBits),
                expected_loc + text1.length - this.Match_MaxBits
              );
              if (end_loc == -1 || start_loc >= end_loc) {
                start_loc = -1;
              }
            }
          } else {
            start_loc = this.match_main(text, text1, expected_loc);
          }
          if (start_loc == -1) {
            results[x] = false;
            delta -= patches[x].length2 - patches[x].length1;
          } else {
            results[x] = true;
            delta = start_loc - expected_loc;
            var text2;
            if (end_loc == -1) {
              text2 = text.substring(start_loc, start_loc + text1.length);
            } else {
              text2 = text.substring(start_loc, end_loc + this.Match_MaxBits);
            }
            if (text1 == text2) {
              text = text.substring(0, start_loc) + this.diff_text2(patches[x].diffs) + text.substring(start_loc + text1.length);
            } else {
              var diffs = this.diff_main(text1, text2, false);
              if (text1.length > this.Match_MaxBits && this.diff_levenshtein(diffs) / text1.length > this.Patch_DeleteThreshold) {
                results[x] = false;
              } else {
                this.diff_cleanupSemanticLossless(diffs);
                var index1 = 0;
                var index2;
                for (var y = 0; y < patches[x].diffs.length; y++) {
                  var mod = patches[x].diffs[y];
                  if (mod[0] !== DIFF_EQUAL) {
                    index2 = this.diff_xIndex(diffs, index1);
                  }
                  if (mod[0] === DIFF_INSERT) {
                    text = text.substring(0, start_loc + index2) + mod[1] + text.substring(start_loc + index2);
                  } else if (mod[0] === DIFF_DELETE) {
                    text = text.substring(0, start_loc + index2) + text.substring(start_loc + this.diff_xIndex(
                      diffs,
                      index1 + mod[1].length
                    ));
                  }
                  if (mod[0] !== DIFF_DELETE) {
                    index1 += mod[1].length;
                  }
                }
              }
            }
          }
        }
        text = text.substring(nullPadding.length, text.length - nullPadding.length);
        return [text, results];
      };
      diff_match_patch2.prototype.patch_addPadding = function(patches) {
        var paddingLength = this.Patch_Margin;
        var nullPadding = "";
        for (var x = 1; x <= paddingLength; x++) {
          nullPadding += String.fromCharCode(x);
        }
        for (var x = 0; x < patches.length; x++) {
          patches[x].start1 += paddingLength;
          patches[x].start2 += paddingLength;
        }
        var patch = patches[0];
        var diffs = patch.diffs;
        if (diffs.length == 0 || diffs[0][0] != DIFF_EQUAL) {
          diffs.unshift(new diff_match_patch2.Diff(DIFF_EQUAL, nullPadding));
          patch.start1 -= paddingLength;
          patch.start2 -= paddingLength;
          patch.length1 += paddingLength;
          patch.length2 += paddingLength;
        } else if (paddingLength > diffs[0][1].length) {
          var extraLength = paddingLength - diffs[0][1].length;
          diffs[0][1] = nullPadding.substring(diffs[0][1].length) + diffs[0][1];
          patch.start1 -= extraLength;
          patch.start2 -= extraLength;
          patch.length1 += extraLength;
          patch.length2 += extraLength;
        }
        patch = patches[patches.length - 1];
        diffs = patch.diffs;
        if (diffs.length == 0 || diffs[diffs.length - 1][0] != DIFF_EQUAL) {
          diffs.push(new diff_match_patch2.Diff(DIFF_EQUAL, nullPadding));
          patch.length1 += paddingLength;
          patch.length2 += paddingLength;
        } else if (paddingLength > diffs[diffs.length - 1][1].length) {
          var extraLength = paddingLength - diffs[diffs.length - 1][1].length;
          diffs[diffs.length - 1][1] += nullPadding.substring(0, extraLength);
          patch.length1 += extraLength;
          patch.length2 += extraLength;
        }
        return nullPadding;
      };
      diff_match_patch2.prototype.patch_splitMax = function(patches) {
        var patch_size = this.Match_MaxBits;
        for (var x = 0; x < patches.length; x++) {
          if (patches[x].length1 <= patch_size) {
            continue;
          }
          var bigpatch = patches[x];
          patches.splice(x--, 1);
          var start1 = bigpatch.start1;
          var start2 = bigpatch.start2;
          var precontext = "";
          while (bigpatch.diffs.length !== 0) {
            var patch = new diff_match_patch2.patch_obj();
            var empty = true;
            patch.start1 = start1 - precontext.length;
            patch.start2 = start2 - precontext.length;
            if (precontext !== "") {
              patch.length1 = patch.length2 = precontext.length;
              patch.diffs.push(new diff_match_patch2.Diff(DIFF_EQUAL, precontext));
            }
            while (bigpatch.diffs.length !== 0 && patch.length1 < patch_size - this.Patch_Margin) {
              var diff_type = bigpatch.diffs[0][0];
              var diff_text = bigpatch.diffs[0][1];
              if (diff_type === DIFF_INSERT) {
                patch.length2 += diff_text.length;
                start2 += diff_text.length;
                patch.diffs.push(bigpatch.diffs.shift());
                empty = false;
              } else if (diff_type === DIFF_DELETE && patch.diffs.length == 1 && patch.diffs[0][0] == DIFF_EQUAL && diff_text.length > 2 * patch_size) {
                patch.length1 += diff_text.length;
                start1 += diff_text.length;
                empty = false;
                patch.diffs.push(new diff_match_patch2.Diff(diff_type, diff_text));
                bigpatch.diffs.shift();
              } else {
                diff_text = diff_text.substring(
                  0,
                  patch_size - patch.length1 - this.Patch_Margin
                );
                patch.length1 += diff_text.length;
                start1 += diff_text.length;
                if (diff_type === DIFF_EQUAL) {
                  patch.length2 += diff_text.length;
                  start2 += diff_text.length;
                } else {
                  empty = false;
                }
                patch.diffs.push(new diff_match_patch2.Diff(diff_type, diff_text));
                if (diff_text == bigpatch.diffs[0][1]) {
                  bigpatch.diffs.shift();
                } else {
                  bigpatch.diffs[0][1] = bigpatch.diffs[0][1].substring(diff_text.length);
                }
              }
            }
            precontext = this.diff_text2(patch.diffs);
            precontext = precontext.substring(precontext.length - this.Patch_Margin);
            var postcontext = this.diff_text1(bigpatch.diffs).substring(0, this.Patch_Margin);
            if (postcontext !== "") {
              patch.length1 += postcontext.length;
              patch.length2 += postcontext.length;
              if (patch.diffs.length !== 0 && patch.diffs[patch.diffs.length - 1][0] === DIFF_EQUAL) {
                patch.diffs[patch.diffs.length - 1][1] += postcontext;
              } else {
                patch.diffs.push(new diff_match_patch2.Diff(DIFF_EQUAL, postcontext));
              }
            }
            if (!empty) {
              patches.splice(++x, 0, patch);
            }
          }
        }
      };
      diff_match_patch2.prototype.patch_toText = function(patches) {
        var text = [];
        for (var x = 0; x < patches.length; x++) {
          text[x] = patches[x];
        }
        return text.join("");
      };
      diff_match_patch2.prototype.patch_fromText = function(textline) {
        var patches = [];
        if (!textline) {
          return patches;
        }
        var text = textline.split("\n");
        var textPointer = 0;
        var patchHeader = /^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@$/;
        while (textPointer < text.length) {
          var m = text[textPointer].match(patchHeader);
          if (!m) {
            throw new Error("Invalid patch string: " + text[textPointer]);
          }
          var patch = new diff_match_patch2.patch_obj();
          patches.push(patch);
          patch.start1 = parseInt(m[1], 10);
          if (m[2] === "") {
            patch.start1--;
            patch.length1 = 1;
          } else if (m[2] == "0") {
            patch.length1 = 0;
          } else {
            patch.start1--;
            patch.length1 = parseInt(m[2], 10);
          }
          patch.start2 = parseInt(m[3], 10);
          if (m[4] === "") {
            patch.start2--;
            patch.length2 = 1;
          } else if (m[4] == "0") {
            patch.length2 = 0;
          } else {
            patch.start2--;
            patch.length2 = parseInt(m[4], 10);
          }
          textPointer++;
          while (textPointer < text.length) {
            var sign = text[textPointer].charAt(0);
            try {
              var line = decodeURI(text[textPointer].substring(1));
            } catch (ex) {
              throw new Error("Illegal escape in patch_fromText: " + line);
            }
            if (sign == "-") {
              patch.diffs.push(new diff_match_patch2.Diff(DIFF_DELETE, line));
            } else if (sign == "+") {
              patch.diffs.push(new diff_match_patch2.Diff(DIFF_INSERT, line));
            } else if (sign == " ") {
              patch.diffs.push(new diff_match_patch2.Diff(DIFF_EQUAL, line));
            } else if (sign == "@") {
              break;
            } else if (sign === "") {
            } else {
              throw new Error('Invalid patch mode "' + sign + '" in: ' + line);
            }
            textPointer++;
          }
        }
        return patches;
      };
      diff_match_patch2.patch_obj = function() {
        this.diffs = [];
        this.start1 = null;
        this.start2 = null;
        this.length1 = 0;
        this.length2 = 0;
      };
      diff_match_patch2.patch_obj.prototype.toString = function() {
        var coords1, coords2;
        if (this.length1 === 0) {
          coords1 = this.start1 + ",0";
        } else if (this.length1 == 1) {
          coords1 = this.start1 + 1;
        } else {
          coords1 = this.start1 + 1 + "," + this.length1;
        }
        if (this.length2 === 0) {
          coords2 = this.start2 + ",0";
        } else if (this.length2 == 1) {
          coords2 = this.start2 + 1;
        } else {
          coords2 = this.start2 + 1 + "," + this.length2;
        }
        var text = ["@@ -" + coords1 + " +" + coords2 + " @@\n"];
        var op;
        for (var x = 0; x < this.diffs.length; x++) {
          switch (this.diffs[x][0]) {
            case DIFF_INSERT:
              op = "+";
              break;
            case DIFF_DELETE:
              op = "-";
              break;
            case DIFF_EQUAL:
              op = " ";
              break;
          }
          text[x + 1] = op + encodeURI(this.diffs[x][1]) + "\n";
        }
        return text.join("").replace(/%20/g, " ");
      };
      module.exports = diff_match_patch2;
      module.exports["diff_match_patch"] = diff_match_patch2;
      module.exports["DIFF_DELETE"] = DIFF_DELETE;
      module.exports["DIFF_INSERT"] = DIFF_INSERT;
      module.exports["DIFF_EQUAL"] = DIFF_EQUAL;
    }
  });

  // shared/google-sync/entry.ts
  var entry_exports = {};
  __export(entry_exports, {
    branchClipboard: () => branchClipboard,
    branchHistory: () => branchHistory,
    chatConfig: () => chatConfig,
    chatSearch: () => chatSearch,
    composerContent: () => composerContent,
    documentOperation: () => documentOperation,
    drain: () => drain,
    driveFolderName: () => driveFolderName,
    driveHeaderID: () => driveHeaderID,
    driveListing: () => driveListing,
    fileExport: () => fileExport,
    fileImport: () => fileImport,
    folderOperation: () => folderOperation,
    folderRows: () => folderRows,
    generationRequest: () => generationRequest,
    libraryDefaults: () => libraryDefaults,
    libraryOperation: () => libraryOperation,
    messageAttributesOperation: () => messageAttributesOperation,
    messageEdit: () => messageEdit,
    navigationOperation: () => navigationOperation,
    nodeOptions: () => nodeOptions,
    nodeRemoval: () => nodeRemoval,
    recordsResult: () => recordsResult,
    recordsStart: () => recordsStart,
    result: () => result2,
    settle: () => settle,
    start: () => start,
    treeEdit: () => treeEdit
  });

  // shared/google-sync/importDefaults.generated.json
  var importDefaults_generated_default = {
    keys: [
      "lastContentEditedAt",
      "apiKey",
      "apiVersion",
      "apiEndpoint",
      "theme",
      "autoTitle",
      "titleModel",
      "titleProviderId",
      "bubbleSummaryConfig",
      "advancedMode",
      "prompts",
      "defaultChatConfig",
      "defaultSystemMessage",
      "hideMenuOptions",
      "hideSideMenu",
      "folders",
      "enterToSubmit",
      "inlineLatex",
      "markdownMode",
      "streamingMarkdownPolicy",
      "totalTokenUsed",
      "countTotalTokens",
      "displayChatSize",
      "menuWidth",
      "defaultImageDetail",
      "animateBubbleNavigation",
      "branchSwipeDirection",
      "providers",
      "favoriteModels",
      "providerModelCache",
      "providerCustomModels",
      "_legacyCustomModels",
      "onboardingCompleted",
      "splitPanelRatio",
      "splitPanelSwapped",
      "chatActiveView",
      "proxyEnabled",
      "proxyEndpoint",
      "proxyAuthToken",
      "showDebugPanel",
      "searchHistory",
      "sidebarSearchHistory",
      "chatFindHistory",
      "verifiedStats",
      "pendingVerifications",
      "evaluationSettings",
      "safetyThresholds",
      "qualityThresholds",
      "evaluationResults",
      "localModelEnabled",
      "localModels",
      "favoriteLocalModelIds",
      "localModelExecutionMode",
      "activeLocalModels",
      "savedModelMeta",
      "chats",
      "contentStore",
      "branchClipboard"
    ],
    values: {
      apiEndpoint: "https://api.openai.com/v1/chat/completions",
      theme: "dark",
      autoTitle: false,
      titleModel: "",
      advancedMode: true,
      prompts: [
        {
          id: "0d3e9cb7-b585-43fa-acc3-840c189f6b93",
          name: "English Translator",
          prompt: "I want you to act as an English translator, spelling corrector and improver. I will speak to you in any language and you will detect the language, translate it and answer in the corrected and improved version of my text, in English. I want you to replace my simplified A0-level words and sentences with more beautiful and elegant, upper level English words and sentences. Keep the meaning same, but make them more literary. I want you to only reply the correction, the improvements and nothing else, do not write explanations. Do you understand?"
        }
      ],
      defaultChatConfig: {
        model: "",
        max_tokens: 4e3,
        temperature: 1,
        presence_penalty: 0,
        top_p: 1,
        frequency_penalty: 0,
        stream: true,
        reasoning_effort: "none",
        reasoning_budget_tokens: 0
      },
      defaultSystemMessage: "You are a large language model assistant.\nCarefully heed the user's instructions. \nRespond using Markdown.",
      hideMenuOptions: false,
      hideSideMenu: false,
      folders: {},
      enterToSubmit: true,
      inlineLatex: false,
      markdownMode: true,
      streamingMarkdownPolicy: "auto",
      totalTokenUsed: {},
      countTotalTokens: false,
      displayChatSize: false,
      menuWidth: 260,
      defaultImageDetail: "auto",
      animateBubbleNavigation: true,
      branchSwipeDirection: "left-next",
      providers: {
        openrouter: {
          id: "openrouter",
          name: "OpenRouter",
          endpoint: "https://openrouter.ai/api/v1/chat/completions",
          modelsEndpoint: "https://openrouter.ai/api/v1/models",
          modelsRequireAuth: false
        },
        openai: {
          id: "openai",
          name: "OpenAI",
          endpoint: "https://api.openai.com/v1/chat/completions",
          modelsEndpoint: "https://api.openai.com/v1/models",
          modelsRequireAuth: true
        },
        mistral: {
          id: "mistral",
          name: "Mistral",
          endpoint: "https://api.mistral.ai/v1/chat/completions",
          modelsEndpoint: "https://api.mistral.ai/v1/models",
          modelsRequireAuth: true
        },
        groq: {
          id: "groq",
          name: "Groq",
          endpoint: "https://api.groq.com/openai/v1/chat/completions",
          modelsEndpoint: "https://api.groq.com/openai/v1/models",
          modelsRequireAuth: true
        },
        together: {
          id: "together",
          name: "Together AI",
          endpoint: "https://api.together.xyz/v1/chat/completions",
          modelsEndpoint: "https://api.together.xyz/v1/models",
          modelsRequireAuth: true
        },
        cohere: {
          id: "cohere",
          name: "Cohere",
          endpoint: "https://api.cohere.ai/v2/chat",
          modelsEndpoint: "https://api.cohere.ai/v2/models",
          modelsRequireAuth: true
        },
        perplexity: {
          id: "perplexity",
          name: "Perplexity",
          endpoint: "https://api.perplexity.ai/chat/completions",
          modelsRequireAuth: false
        },
        deepseek: {
          id: "deepseek",
          name: "DeepSeek",
          endpoint: "https://api.deepseek.com/chat/completions",
          modelsEndpoint: "https://api.deepseek.com/models",
          modelsRequireAuth: true
        },
        xai: {
          id: "xai",
          name: "xAI",
          endpoint: "https://api.x.ai/v1/chat/completions",
          modelsEndpoint: "https://api.x.ai/v1/models",
          modelsRequireAuth: true
        },
        fireworks: {
          id: "fireworks",
          name: "Fireworks",
          endpoint: "https://api.fireworks.ai/inference/v1/chat/completions",
          modelsEndpoint: "https://api.fireworks.ai/inference/v1/models",
          modelsRequireAuth: true
        }
      },
      favoriteModels: [],
      providerModelCache: {},
      providerCustomModels: {},
      onboardingCompleted: false,
      splitPanelRatio: 0.5,
      splitPanelSwapped: false,
      chatActiveView: "chat",
      proxyEnabled: false,
      proxyEndpoint: "",
      proxyAuthToken: "",
      showDebugPanel: false,
      searchHistory: [],
      sidebarSearchHistory: [],
      chatFindHistory: [],
      verifiedStats: {},
      pendingVerifications: {},
      evaluationSettings: {
        safetyPreSend: "manual",
        safetyPostReceive: "manual",
        qualityPreSend: "manual",
        qualityPostReceive: "manual",
        safetyEngine: "remote",
        hybridRemoteOnSafe: true
      },
      safetyThresholds: {
        sexual: {
          review: 0.8,
          block: 0.95
        },
        hate: {
          review: 0.7,
          block: 0.9
        },
        harassment: {
          review: 0.75,
          block: 0.92
        },
        "self-harm": {
          review: 0.55,
          block: 0.85
        },
        "sexual/minors": {
          review: 0.08,
          block: 0.2
        },
        "hate/threatening": {
          review: 0.35,
          block: 0.7
        },
        "violence/graphic": {
          review: 0.55,
          block: 0.82
        },
        violence: {
          review: 0.75,
          block: 0.93
        },
        "harassment/threatening": {
          review: 0.45,
          block: 0.75
        },
        "self-harm/intent": {
          review: 0.35,
          block: 0.7
        },
        "self-harm/instructions": {
          review: 0.2,
          block: 0.45
        },
        illicit: {
          review: 0.7,
          block: 0.9
        },
        "illicit/violent": {
          review: 0.25,
          block: 0.55
        }
      },
      qualityThresholds: {
        taskCompletion: {
          red: 0.5,
          green: 0.8
        },
        faithfulness: {
          red: 0.5,
          green: 0.8
        },
        coherence: {
          red: 0.5,
          green: 0.8
        },
        conciseness: {
          red: 0.5,
          green: 0.8
        },
        instructionFollowing: {
          red: 0.5,
          green: 0.8
        }
      },
      evaluationResults: {},
      localModelEnabled: false,
      localModels: [],
      favoriteLocalModelIds: [],
      localModelExecutionMode: "sequential",
      activeLocalModels: {},
      savedModelMeta: {},
      contentStore: {},
      branchClipboard: null
    }
  };

  // src/types/chat.ts
  var roles = ["user", "assistant", "system"];
  function strToTextContent(ob) {
    return {
      type: "text",
      text: ob
    };
  }
  function isTextContent(ob) {
    return ob !== void 0 && ob !== null && ob.type === "text";
  }
  function isImageContent(ob) {
    return ob !== void 0 && ob !== null && ob.image_url !== void 0;
  }
  function isToolCallContent(ob) {
    return ob !== void 0 && ob !== null && ob.type === "tool_call";
  }
  function isToolResultContent(ob) {
    return ob !== void 0 && ob !== null && ob.type === "tool_result";
  }

  // src/utils/contentValidation.ts
  var hasMeaningfulContent = (content) => content.some((part) => {
    if (isImageContent(part))
      return true;
    return isTextContent(part) && part.text.trim().length > 0;
  });
  var hasMeaningfulMessageContent = (messages) => messages.some((message) => hasMeaningfulContent(message.content));

  // src/utils/messageText.ts
  var firstTextIndex = (content) => content.findIndex((item) => item.type === "text");
  var textValueOf = (content) => {
    const index = firstTextIndex(content);
    return index >= 0 ? content[index].text : "";
  };
  var replaceTextValue = (content, text) => {
    const index = firstTextIndex(content);
    if (index < 0) {
      return [{ type: "text", text }, ...content];
    }
    const next = [...content];
    next[index] = { ...content[index], text };
    return next;
  };

  // src/utils/branchUtils.ts
  var import_lodash = __toESM(require_lodash(), 1);

  // src/utils/streamingBuffer.ts
  var STREAMING_CONTENT_HASH_PREFIX = "__streaming:";
  var streamingBuffers = /* @__PURE__ */ new Map();
  var cloneContentItem = (content) => {
    if (content.type === "image_url")
      return { ...content, image_url: { ...content.image_url } };
    return { ...content };
  };
  var cloneContent = (content) => content.map(cloneContentItem);
  var bufferKey = (chatId, nodeId) => JSON.stringify([chatId, nodeId]);
  var isStreamingContentHash = (hash) => hash.startsWith(STREAMING_CONTENT_HASH_PREFIX);
  var getStreamingTargetFromHash = (hash) => {
    if (!isStreamingContentHash(hash))
      return null;
    try {
      const target = JSON.parse(hash.slice(STREAMING_CONTENT_HASH_PREFIX.length));
      return Array.isArray(target) && target.length === 2 && target.every((value) => typeof value === "string") ? { chatId: target[0], nodeId: target[1] } : null;
    } catch {
      return null;
    }
  };
  var getBufferedContent = (chatId, nodeId) => {
    const key = bufferKey(chatId, nodeId);
    const entry = streamingBuffers.get(key);
    return entry ? cloneContent(entry.content) : void 0;
  };
  var peekBufferedContent = (chatId, nodeId) => {
    const key = bufferKey(chatId, nodeId);
    return streamingBuffers.get(key)?.content;
  };
  var finalizeStreamingSnapshotState = (chats, contentStore) => {
    if (!chats || chats.length === 0) {
      return { chats, contentStore, changed: false };
    }
    let updatedChats = chats;
    let updatedContentStore = contentStore;
    let changed = false;
    const rematerializedChatIndexes = /* @__PURE__ */ new Set();
    chats.forEach((chat, chatIndex) => {
      const tree = chat.branchTree;
      if (!tree)
        return;
      Object.values(tree.nodes).forEach((node) => {
        if (!isStreamingContentHash(node.contentHash))
          return;
        const bufferedContent = getBufferedContent(chat.id, node.id);
        if (!bufferedContent)
          return;
        if (!changed) {
          updatedChats = chats.slice();
          updatedContentStore = Object.fromEntries(Object.entries(contentStore).map(([hash, entry]) => [hash, { ...entry }]));
          changed = true;
        }
        if (updatedChats[chatIndex] === chats[chatIndex]) {
          updatedChats = cloneChatAt(updatedChats, chatIndex);
        }
        const updatedChat = updatedChats[chatIndex];
        const updatedTree = updatedChat.branchTree;
        updatedTree.nodes[node.id] = {
          ...updatedTree.nodes[node.id],
          contentHash: addContent(updatedContentStore, bufferedContent)
        };
        rematerializedChatIndexes.add(chatIndex);
      });
    });
    rematerializedChatIndexes.forEach((chatIndex) => {
      const chat = updatedChats[chatIndex];
      if (!chat.branchTree)
        return;
      chat.messages = materializeActivePath(chat.branchTree, updatedContentStore);
    });
    return { chats: updatedChats, contentStore: updatedContentStore, changed };
  };

  // src/utils/contentStore.ts
  var import_diff_match_patch = __toESM(require_diff_match_patch());
  var dmp = new import_diff_match_patch.diff_match_patch();
  var MAX_CHAIN_DEPTH = 5;
  var pendingGCHashes = /* @__PURE__ */ new Set();
  var DELTA_SIZE_THRESHOLD = 0.7;
  function isDeltaEligible(content) {
    return content.length > 0 && content.every((c) => c.type === "text");
  }
  function computeContentHash(content) {
    const str = JSON.stringify(content);
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = hash * 16777619 >>> 0;
    }
    return hash.toString(36);
  }
  function getChainDepth(store, hash) {
    let depth = 0;
    let current = hash;
    const visited = /* @__PURE__ */ new Set();
    while (store[current]?.delta) {
      if (visited.has(current))
        return MAX_CHAIN_DEPTH + 1;
      visited.add(current);
      depth++;
      current = store[current].delta.baseHash;
    }
    return depth;
  }
  function contentToText(content) {
    return JSON.stringify(content);
  }
  function addContent(store, content) {
    let hash = computeContentHash(content);
    const serialized = JSON.stringify(content);
    while (store[hash] && !isContentMatch(store, hash, serialized)) {
      hash += "_";
    }
    if (store[hash]) {
      store[hash].refCount++;
    } else {
      store[hash] = { content, refCount: 1 };
    }
    return hash;
  }
  function isContentMatch(store, hash, serialized) {
    const entry = store[hash];
    if (!entry)
      return false;
    if (entry.delta) {
      const resolved = resolveContent(store, hash);
      return JSON.stringify(resolved) === serialized;
    }
    return JSON.stringify(entry.content) === serialized;
  }
  function addContentDelta(store, content, baseHash) {
    const baseEntry = store[baseHash];
    if (!baseEntry)
      return addContent(store, content);
    if (!isDeltaEligible(content))
      return addContent(store, content);
    const baseContent = resolveContent(store, baseHash);
    if (!isDeltaEligible(baseContent))
      return addContent(store, content);
    if (getChainDepth(store, baseHash) >= MAX_CHAIN_DEPTH - 1) {
      return addContent(store, content);
    }
    let hash = computeContentHash(content);
    const serialized = JSON.stringify(content);
    while (store[hash] && !isContentMatch(store, hash, serialized)) {
      hash += "_";
    }
    if (store[hash]) {
      store[hash].refCount++;
      return hash;
    }
    const baseText = contentToText(baseContent);
    const newText = contentToText(content);
    const patches = dmp.patch_make(baseText, newText);
    const patchText = dmp.patch_toText(patches);
    if (patchText.length >= newText.length * DELTA_SIZE_THRESHOLD) {
      store[hash] = { content, refCount: 1 };
      return hash;
    }
    store[hash] = {
      content: [],
      refCount: 1,
      delta: {
        baseHash,
        patches: patchText
      }
    };
    return hash;
  }
  function retainContent(store, hash) {
    if (isStreamingContentHash(hash))
      return;
    if (store[hash]) {
      store[hash].refCount++;
    }
  }
  function promoteDependents(store, baseHash) {
    for (const [hash, entry] of Object.entries(store)) {
      if (entry.delta?.baseHash === baseHash) {
        const resolved = resolveContent(store, hash);
        entry.content = resolved;
        delete entry.delta;
      }
    }
  }
  function releaseContent(store, hash) {
    if (isStreamingContentHash(hash))
      return;
    if (!store[hash])
      return;
    store[hash].refCount--;
    if (store[hash].refCount <= 0) {
      promoteDependents(store, hash);
      pendingGCHashes.add(hash);
    }
  }
  function resolveContent(store, hash) {
    if (isStreamingContentHash(hash)) {
      const target = getStreamingTargetFromHash(hash);
      return target ? peekBufferedContent(target.chatId, target.nodeId) ?? [] : [];
    }
    const entry = store[hash];
    if (!entry)
      return [];
    if (!entry.delta) {
      return entry.content;
    }
    const text = resolveDeltaContentJSON(store, hash);
    return text === null ? [] : JSON.parse(text);
  }
  function resolveDeltaContentJSON(store, hash) {
    const visited = /* @__PURE__ */ new Set();
    let current = hash;
    const deltaChain = [];
    while (store[current]?.delta) {
      if (visited.has(current)) {
        console.error(`[ContentStore] Circular delta chain detected at ${current}`);
        return null;
      }
      visited.add(current);
      deltaChain.push({
        hash: current,
        patches: store[current].delta.patches
      });
      current = store[current].delta.baseHash;
    }
    const baseEntry = store[current];
    if (!baseEntry) {
      console.error(`[ContentStore] Missing delta base: ${current}`);
      return null;
    }
    let text = contentToText(baseEntry.content);
    for (const { patches: patchText } of deltaChain.reverse()) {
      const patches = dmp.patch_fromText(patchText);
      const [result3, applied] = dmp.patch_apply(patches, text);
      if (applied.some((ok) => !ok)) {
        console.error(`[ContentStore] Patch apply failed for delta chain`);
        return null;
      }
      text = result3;
    }
    try {
      JSON.parse(text);
      return text;
    } catch {
      console.error(`[ContentStore] Failed to parse resolved delta content`);
      return null;
    }
  }
  function isContentEqual(store, hash, content) {
    const resolved = resolveContent(store, hash);
    return JSON.stringify(resolved) === JSON.stringify(content);
  }
  function resolveContentText(store, hash) {
    const content = resolveContent(store, hash);
    return content.filter((c) => c.type === "text").map((c) => c.text).join(" ");
  }
  function buildExportContentStore(store) {
    const exported = {};
    for (const [hash, entry] of Object.entries(store)) {
      const { delta, ...fullEntry } = entry;
      if (delta) {
        exported[hash] = {
          ...fullEntry,
          content: resolveContent(store, hash)
        };
      } else {
        exported[hash] = fullEntry;
      }
    }
    return exported;
  }
  function validateDeltaIntegrity(store) {
    const corrupt = /* @__PURE__ */ new Set();
    for (const [hash, entry] of Object.entries(store)) {
      if (!entry.delta)
        continue;
      if (!store[entry.delta.baseHash]) {
        console.warn(
          `[ContentStore] Broken delta: ${hash} references missing base ${entry.delta.baseHash}`
        );
        corrupt.add(hash);
        continue;
      }
      const visited = /* @__PURE__ */ new Set();
      let cur = hash;
      let isCircular = false;
      while (store[cur]?.delta) {
        if (visited.has(cur)) {
          isCircular = true;
          break;
        }
        visited.add(cur);
        cur = store[cur].delta.baseHash;
      }
      if (isCircular) {
        console.warn(`[ContentStore] Circular delta chain detected at ${hash}`);
        corrupt.add(hash);
        continue;
      }
      try {
        const patches = dmp.patch_fromText(entry.delta.patches);
        const baseContent = store[cur]?.content;
        if (baseContent) {
          let text = contentToText(baseContent);
          const chain = [];
          let walk = hash;
          while (store[walk]?.delta) {
            chain.push(walk);
            walk = store[walk].delta.baseHash;
          }
          let patchFailed = false;
          for (const chainHash of chain.reverse()) {
            const p = dmp.patch_fromText(store[chainHash].delta.patches);
            const [result3, applied] = dmp.patch_apply(p, text);
            if (applied.some((ok) => !ok)) {
              patchFailed = true;
              break;
            }
            text = result3;
          }
          if (patchFailed) {
            console.warn(`[ContentStore] Patch apply failed for delta ${hash}`);
            corrupt.add(hash);
            continue;
          }
          JSON.parse(text);
        }
      } catch (e) {
        console.warn(`[ContentStore] Delta validation error for ${hash}:`, e);
        corrupt.add(hash);
      }
    }
    if (corrupt.size > 0) {
      console.warn(
        `[ContentStore] ${corrupt.size} corrupt delta(s) detected at startup. Affected hashes will return empty content on read.`
      );
    }
    return corrupt;
  }

  // src/utils/branchUtils.ts
  function readMessageAttributes(owner) {
    const value = owner.messageAttributesV1;
    if (!Object.hasOwn(owner, "messageAttributesV1"))
      return void 0;
    if (!value || value.version !== 1 || !value.byNode || typeof value.byNode !== "object" || Array.isArray(value.byNode) || Object.keys(value).some((key) => key !== "version" && key !== "byNode") || Object.keys(value.byNode).some((id) => !Object.hasOwn(owner.nodes, id)) || Object.values(value.byNode).some((attributes) => !attributes || typeof attributes !== "object" || Array.isArray(attributes) || Object.hasOwn(attributes, "role") || Object.hasOwn(attributes, "content"))) {
      throw new Error("Unsupported message attributes namespace.");
    }
    return value;
  }
  var extraMessageAttributes = (message) => {
    const { role, content, ...attributes } = message;
    return attributes;
  };
  function setMessageAttributes(owner, nodeId, message) {
    const attributes = extraMessageAttributes(message);
    if (!Object.keys(attributes).length)
      return;
    const previous = readMessageAttributes(owner);
    owner.messageAttributesV1 = { version: 1, byNode: {
      ...previous?.byNode,
      [nodeId]: { ...previous?.byNode[nodeId], ...structuredClone(attributes) }
    } };
  }
  function copyMessageAttributes(source, sourceId, target, targetId) {
    const attributes = readMessageAttributes(source)?.byNode[sourceId];
    if (!attributes)
      return;
    setMessageAttributes(target, targetId, { ...attributes, role: "user", content: [] });
  }
  function deleteMessageAttributes(owner, nodeId) {
    const previous = readMessageAttributes(owner);
    if (!previous || !Object.hasOwn(previous.byNode, nodeId))
      return;
    const byNode = { ...previous.byNode };
    delete byNode[nodeId];
    owner.messageAttributesV1 = { version: 1, byNode };
  }
  function captureProjectedMessageAttributes(chat, contentStore) {
    if (!chat.branchTree)
      return;
    let next = chat.branchTree;
    for (const [index, message] of (chat.messages ?? []).entries()) {
      const attributes = extraMessageAttributes(message);
      if (!Object.keys(attributes).length)
        continue;
      const nodeId = chat.branchTree.activePath[index], node = chat.branchTree.nodes[nodeId];
      if (!node || node.role !== message.role || !(0, import_lodash.isEqual)(resolveContent(contentStore, node.contentHash), message.content))
        throw new Error("Message attributes do not match the active branch.");
      const existing = readMessageAttributes(next)?.byNode[nodeId];
      for (const [key, value] of Object.entries(attributes))
        if (existing && Object.hasOwn(existing, key) && !(0, import_lodash.isEqual)(existing[key], value))
          throw new Error("Conflicting projected message attributes.");
      if (next === chat.branchTree)
        next = { ...next };
      setMessageAttributes(next, nodeId, message);
    }
    chat.branchTree = next;
  }
  function projectMessageAttributes(owner, nodeId, message) {
    return { ...structuredClone(readMessageAttributes(owner)?.byNode[nodeId] ?? {}), role: message.role, content: message.content };
  }
  function materializeActivePath(tree, contentStore, includeAttributes = false) {
    return tree.activePath.map((id) => {
      const node = tree.nodes[id];
      const message = { role: node.role, content: resolveContent(contentStore, node.contentHash) };
      return includeAttributes ? projectMessageAttributes(tree, id, message) : message;
    });
  }
  function flatMessagesToBranchTree(messages, contentStore) {
    const nodes = {};
    const ids = [];
    const tree = { nodes, rootId: "", activePath: ids };
    for (let i = 0; i < messages.length; i++) {
      const id = editingUUID();
      ids.push(id);
      const contentHash = addContent(contentStore, messages[i].content);
      nodes[id] = {
        id,
        parentId: i === 0 ? null : ids[i - 1],
        role: messages[i].role,
        contentHash,
        createdAt: Date.now() - (messages.length - i) * 1e3
      };
      setMessageAttributes(tree, id, messages[i]);
    }
    tree.rootId = ids[0] ?? "";
    return tree;
  }
  function flatChatToBranchTree(chat, contentStore) {
    if (chat.branchTree)
      return;
    const tree = flatMessagesToBranchTree(chat.messages, contentStore);
    for (const field of ["collapsedNodes", "omittedNodes", "protectedNodes"]) {
      if (!chat[field])
        continue;
      chat[field] = Object.fromEntries(Object.entries(chat[field]).map(([key, value]) => {
        const index = Number(key);
        const id = Number.isInteger(index) && index >= 0 && String(index) === key ? tree.activePath[index] : void 0;
        return [id ?? key, value];
      }));
    }
    chat.branchTree = tree;
    chat.messages = materializeActivePath(tree, contentStore);
  }
  function getChildrenOf(tree, nodeId) {
    return Object.values(tree.nodes).filter((n) => n.parentId === nodeId);
  }
  function getSiblingGroups(tree) {
    const grouped = /* @__PURE__ */ new Map();
    const nodes = Object.values(tree.nodes);
    for (const node of nodes) {
      const group = grouped.get(node.parentId) ?? [];
      group.push(node);
      grouped.set(node.parentId, group);
    }
    const groups = [];
    const byParent = /* @__PURE__ */ new Map();
    const byNode = /* @__PURE__ */ Object.create(null);
    for (const node of nodes) {
      const parent = node.parentId || null;
      let groupIndex = byParent.get(parent);
      if (groupIndex === void 0) {
        groupIndex = groups.length;
        byParent.set(parent, groupIndex);
        const group = grouped.get(parent) ?? [];
        groups.push(group);
        group.forEach((sibling, index) => {
          byNode[sibling.id] = { groupIndex, selectedIndex: index };
        });
      }
      if (!byNode[node.id])
        byNode[node.id] = { groupIndex, selectedIndex: -1 };
    }
    return { groups, byNode };
  }
  function buildPathToLeaf(tree, nodeId) {
    const ancestors = [];
    let cur = nodeId;
    while (cur) {
      ancestors.unshift(cur);
      cur = tree.nodes[cur]?.parentId ?? null;
    }
    let tip = nodeId;
    while (true) {
      const children = getChildrenOf(tree, tip);
      if (children.length === 0)
        break;
      children.sort((a, b) => b.createdAt - a.createdAt);
      ancestors.push(children[0].id);
      tip = children[0].id;
    }
    return ancestors;
  }
  function collectDescendants(tree, nodeId) {
    const result3 = /* @__PURE__ */ new Set();
    const queue = [nodeId];
    while (queue.length > 0) {
      const id = queue.pop();
      result3.add(id);
      for (const child of getChildrenOf(tree, id)) {
        queue.push(child.id);
      }
    }
    return result3;
  }

  // src/store/branch-domain.ts
  var extractSystemText = (content) => content.filter(isTextContent).map((c) => c.text).filter(Boolean).join("\n");
  var syncBubbleToConfig = (chat, tree, contentStore) => {
    const topNodeId = tree.activePath[0];
    if (!topNodeId)
      return;
    const topNode = tree.nodes[topNodeId];
    if (!topNode || topNode.role !== "system")
      return;
    const content = resolveContent(contentStore, topNode.contentHash);
    chat.config = { ...chat.config, systemPrompt: extractSystemText(content) || void 0 };
  };
  var cloneChatAt = (chats, chatIndex) => {
    const result3 = chats.slice();
    const chat = result3[chatIndex];
    result3[chatIndex] = {
      ...chat,
      messages: chat.messages.slice(),
      branchTree: chat.branchTree ? {
        ...chat.branchTree,
        nodes: { ...chat.branchTree.nodes },
        activePath: chat.branchTree.activePath.slice(),
        ...chat.branchTree.messageAttributesV1 ? { messageAttributesV1: structuredClone(readMessageAttributes(chat.branchTree)) } : {}
      } : void 0,
      collapsedNodes: chat.collapsedNodes ? { ...chat.collapsedNodes } : void 0,
      omittedNodes: chat.omittedNodes ? { ...chat.omittedNodes } : void 0,
      protectedNodes: chat.protectedNodes ? { ...chat.protectedNodes } : void 0
    };
    return result3;
  };
  var cloneNode = (node) => ({ ...node });
  var ensureBranchReadyState = (chats, chatIndex, currentContentStore) => {
    const contentStore = Object.fromEntries(Object.entries(currentContentStore).map(([hash, entry]) => [hash, { ...entry }]));
    const ensured = ensureBranchTreeState(chats, chatIndex, contentStore);
    return { chats: cloneChatAt(ensured.chats, chatIndex), contentStore: ensured.contentStore };
  };
  var cloneNodeIfPresent = (tree, nodeId) => {
    if (!nodeId)
      return;
    const node = tree.nodes[nodeId];
    if (!node)
      return;
    tree.nodes[nodeId] = cloneNode(node);
  };
  var prepareBranchMutationState = (chats, chatIndex, currentContentStore) => {
    const { chats: updatedChats, contentStore } = ensureBranchReadyState(
      chats,
      chatIndex,
      currentContentStore
    );
    const chat = updatedChats[chatIndex];
    return {
      chats: updatedChats,
      chat,
      tree: chat.branchTree,
      contentStore
    };
  };
  var finalizePreparedBranchMutationState = ({
    chats,
    chat,
    tree,
    contentStore
  }) => {
    tree.rootId = tree.activePath[0] ?? "";
    chat.messages = materializeActivePath(tree, contentStore);
    return { chats, contentStore };
  };
  var removeMessageAtIndexFromPreparedState = (state, messageIndex, options) => {
    const { tree, contentStore } = state;
    const nodeId = tree.activePath[messageIndex];
    if (!nodeId)
      return;
    const parentId = tree.nodes[nodeId]?.parentId ?? null;
    const nextId = tree.activePath[messageIndex + 1] ?? null;
    Object.values(tree.nodes).forEach((node) => {
      if (node.parentId !== nodeId)
        return;
      tree.nodes[node.id] = {
        ...node,
        parentId
      };
    });
    if (nextId) {
      cloneNodeIfPresent(tree, nextId);
      tree.nodes[nextId].parentId = parentId;
    }
    if (!options?.preserveNode) {
      releaseContent(contentStore, tree.nodes[nodeId].contentHash);
      deleteMessageAttributes(tree, nodeId);
      delete tree.nodes[nodeId];
    }
    tree.activePath.splice(messageIndex, 1);
  };
  var ensureBranchTreeState = (chats, chatIndex, currentContentStore) => {
    if (chats[chatIndex]?.branchTree) {
      if (chats[chatIndex].messages.some((message) => Object.keys(message).some((key) => key !== "role" && key !== "content"))) {
        const updatedChats2 = cloneChatAt(chats, chatIndex);
        captureProjectedMessageAttributes(updatedChats2[chatIndex], currentContentStore);
        return { chats: updatedChats2, contentStore: currentContentStore };
      }
      return { chats, contentStore: currentContentStore };
    }
    const contentStore = Object.fromEntries(Object.entries(currentContentStore).map(([hash, entry]) => [hash, { ...entry }]));
    const updatedChats = cloneChatAt(chats, chatIndex);
    flatChatToBranchTree(updatedChats[chatIndex], contentStore);
    return { chats: updatedChats, contentStore };
  };
  var createBranchState = (chats, chatIndex, fromNodeId, newContent, currentContentStore) => {
    const contentStore = { ...currentContentStore };
    const updatedChats = cloneChatAt(chats, chatIndex);
    captureProjectedMessageAttributes(updatedChats[chatIndex], contentStore);
    const tree = updatedChats[chatIndex].branchTree;
    const fromNode = tree.nodes[fromNodeId];
    const newId = editingUUID();
    const contentHash = newContent ? addContentDelta(contentStore, newContent, fromNode.contentHash) : (() => {
      retainContent(contentStore, fromNode.contentHash);
      return fromNode.contentHash;
    })();
    tree.nodes[newId] = {
      id: newId,
      parentId: fromNode.parentId,
      role: fromNode.role,
      contentHash,
      createdAt: Date.now()
    };
    copyMessageAttributes(tree, fromNodeId, tree, newId);
    const fromIdx = tree.activePath.indexOf(fromNodeId);
    tree.activePath = [...tree.activePath.slice(0, fromIdx), newId];
    if (fromIdx === 0)
      syncBubbleToConfig(updatedChats[chatIndex], tree, contentStore);
    updatedChats[chatIndex].messages = materializeActivePath(tree, contentStore);
    return { chats: updatedChats, contentStore, newId };
  };
  var switchActivePathState = (chats, chatIndex, newPath, contentStore) => {
    const updatedChats = cloneChatAt(chats, chatIndex);
    captureProjectedMessageAttributes(updatedChats[chatIndex], contentStore);
    const tree = updatedChats[chatIndex].branchTree;
    tree.activePath = newPath;
    updatedChats[chatIndex].messages = materializeActivePath(tree, contentStore);
    return updatedChats;
  };
  var deleteBranchState = (chats, chatIndex, nodeId, currentContentStore) => {
    const contentStore = Object.fromEntries(Object.entries(currentContentStore).map(([hash, entry]) => [hash, { ...entry }]));
    const updatedChats = cloneChatAt(chats, chatIndex);
    captureProjectedMessageAttributes(updatedChats[chatIndex], contentStore);
    const tree = updatedChats[chatIndex].branchTree;
    const toDelete = collectDescendants(tree, nodeId);
    const parentId = tree.nodes[nodeId]?.parentId;
    toDelete.forEach((id) => {
      releaseContent(contentStore, tree.nodes[id].contentHash);
      deleteMessageAttributes(tree, id);
      delete tree.nodes[id];
    });
    if (tree.activePath.some((id) => toDelete.has(id))) {
      if (parentId) {
        const siblings = getChildrenOf(tree, parentId);
        if (siblings.length > 0) {
          tree.activePath = buildPathToLeaf(tree, siblings[0].id);
        } else {
          const parentIdx = tree.activePath.indexOf(parentId);
          tree.activePath = tree.activePath.slice(0, parentIdx + 1);
        }
      } else {
        tree.activePath = [];
      }
      updatedChats[chatIndex].messages = materializeActivePath(tree, contentStore);
    }
    if (tree.activePath.length)
      tree.rootId = tree.activePath[0];
    else if (!tree.nodes[tree.rootId])
      tree.rootId = "";
    return { chats: updatedChats, contentStore };
  };
  var pruneHiddenNodesState = (chats, chatIndex, currentContentStore) => {
    const contentStore = Object.fromEntries(Object.entries(currentContentStore).map(([hash, entry]) => [hash, { ...entry }]));
    const updatedChats = cloneChatAt(chats, chatIndex);
    captureProjectedMessageAttributes(updatedChats[chatIndex], contentStore);
    const tree = updatedChats[chatIndex].branchTree;
    const activeSet = new Set(tree.activePath);
    const protectedSet = /* @__PURE__ */ new Set();
    for (const node of Object.values(tree.nodes)) {
      if (node.pinned) {
        for (const id of collectDescendants(tree, node.id)) {
          protectedSet.add(id);
        }
      }
    }
    const chatProtectedNodes = updatedChats[chatIndex].protectedNodes;
    if (chatProtectedNodes) {
      for (const [id, value] of Object.entries(chatProtectedNodes)) {
        if (value && tree.nodes[id]) {
          protectedSet.add(id);
        }
      }
    }
    const toDelete = Object.keys(tree.nodes).filter(
      (id) => !activeSet.has(id) && !protectedSet.has(id)
    );
    toDelete.forEach((id) => {
      releaseContent(contentStore, tree.nodes[id].contentHash);
      deleteMessageAttributes(tree, id);
      delete tree.nodes[id];
    });
    for (const id of Object.keys(tree.nodes)) {
      const node = tree.nodes[id];
      if (node.parentId && !tree.nodes[node.parentId]) {
        tree.nodes[id] = cloneNode(node);
        tree.nodes[id].parentId = null;
      }
    }
    if (tree.activePath.length > 0)
      tree.rootId = tree.activePath[0];
    else if (!tree.nodes[tree.rootId])
      tree.rootId = "";
    return { chats: updatedChats, contentStore };
  };
  var setBranchNodeFieldState = (chats, chatIndex, nodeId, field, value) => {
    const updated = cloneChatAt(chats, chatIndex);
    const tree = updated[chatIndex].branchTree;
    tree.nodes[nodeId] = { ...tree.nodes[nodeId], [field]: value };
    return updated;
  };
  var appendNodeToActivePathState = (chats, chatIndex, role, content, currentContentStore) => {
    const { chats: updatedChats, chat, tree, contentStore } = prepareBranchMutationState(chats, chatIndex, currentContentStore);
    const parentId = tree.activePath[tree.activePath.length - 1] ?? null;
    const newId = editingUUID();
    tree.nodes[newId] = {
      id: newId,
      parentId,
      role,
      contentHash: addContent(contentStore, content),
      createdAt: Date.now()
    };
    tree.activePath.push(newId);
    const finalized = finalizePreparedBranchMutationState({
      chats: updatedChats,
      chat,
      tree,
      contentStore
    });
    return { ...finalized, newId };
  };
  var upsertMessageAtIndexState = (chats, chatIndex, messageIndex, message, currentContentStore) => {
    const { chats: updatedChats, chat, tree, contentStore } = prepareBranchMutationState(chats, chatIndex, currentContentStore);
    const existingId = tree.activePath[messageIndex];
    const previousRole = existingId ? tree.nodes[existingId].role : void 0;
    chat.messages[messageIndex] = message;
    if (existingId)
      setMessageAttributes(tree, existingId, message);
    if (existingId) {
      const oldHash = tree.nodes[existingId].contentHash;
      const newHash = addContentDelta(contentStore, message.content, oldHash);
      releaseContent(contentStore, oldHash);
      tree.nodes[existingId] = {
        ...tree.nodes[existingId],
        role: message.role,
        contentHash: newHash
      };
    } else if (messageIndex === tree.activePath.length) {
      const parentId = messageIndex === 0 ? null : tree.activePath[messageIndex - 1] ?? null;
      const newId = editingUUID();
      tree.nodes[newId] = {
        id: newId,
        parentId,
        role: message.role,
        contentHash: addContent(contentStore, message.content),
        createdAt: Date.now()
      };
      setMessageAttributes(tree, newId, message);
      tree.activePath.push(newId);
      if (messageIndex === 0) {
        tree.rootId = newId;
      }
    }
    if (messageIndex === 0) {
      if (previousRole === "system" && message.role !== "system") {
        chat.config = { ...chat.config, systemPrompt: void 0 };
      } else {
        syncBubbleToConfig(chat, tree, contentStore);
      }
    }
    return finalizePreparedBranchMutationState({
      chats: updatedChats,
      chat,
      tree,
      contentStore
    });
  };
  var insertMessageAtIndexState = (chats, chatIndex, messageIndex, message, currentContentStore) => {
    const { chats: updatedChats, chat, tree, contentStore } = prepareBranchMutationState(chats, chatIndex, currentContentStore);
    const prevId = messageIndex > 0 ? tree.activePath[messageIndex - 1] ?? null : null;
    const nextId = tree.activePath[messageIndex];
    const newId = editingUUID();
    tree.nodes[newId] = {
      id: newId,
      parentId: prevId,
      role: message.role,
      contentHash: addContent(contentStore, message.content),
      createdAt: Date.now()
    };
    if (nextId) {
      cloneNodeIfPresent(tree, nextId);
      tree.nodes[nextId].parentId = newId;
    }
    setMessageAttributes(tree, newId, message);
    tree.activePath.splice(messageIndex, 0, newId);
    if (messageIndex === 0) {
      tree.rootId = newId;
    }
    const finalized = finalizePreparedBranchMutationState({
      chats: updatedChats,
      chat,
      tree,
      contentStore
    });
    return { ...finalized, newId };
  };
  var removeMessageAtIndexState = (chats, chatIndex, messageIndex, currentContentStore, options) => {
    const state = prepareBranchMutationState(chats, chatIndex, currentContentStore);
    removeMessageAtIndexFromPreparedState(state, messageIndex, options);
    return finalizePreparedBranchMutationState(state);
  };
  var moveMessageState = (chats, chatIndex, messageIndex, direction, currentContentStore) => {
    const { chats: updatedChats, chat, tree, contentStore } = prepareBranchMutationState(chats, chatIndex, currentContentStore);
    const targetIndex = direction === "up" ? messageIndex - 1 : messageIndex + 1;
    const topNode = tree.activePath[0] ? tree.nodes[tree.activePath[0]] : void 0;
    if (topNode?.role === "system") {
      if (messageIndex === 0 || targetIndex === 0) {
        return finalizePreparedBranchMutationState({
          chats: updatedChats,
          chat,
          tree,
          contentStore
        });
      }
    }
    if (targetIndex < 0 || targetIndex >= tree.activePath.length || messageIndex < 0 || messageIndex >= tree.activePath.length) {
      return finalizePreparedBranchMutationState({
        chats: updatedChats,
        chat,
        tree,
        contentStore
      });
    }
    const start2 = Math.min(messageIndex, targetIndex);
    const end = Math.max(messageIndex, targetIndex);
    const reorderedPath = tree.activePath.slice();
    const [movedId] = reorderedPath.splice(messageIndex, 1);
    reorderedPath.splice(targetIndex, 0, movedId);
    tree.activePath = reorderedPath;
    for (let index = start2; index <= end + 1; index += 1) {
      const nodeId = tree.activePath[index];
      if (!nodeId)
        continue;
      cloneNodeIfPresent(tree, nodeId);
      tree.nodes[nodeId].parentId = index === 0 ? null : tree.activePath[index - 1] ?? null;
    }
    return finalizePreparedBranchMutationState({
      chats: updatedChats,
      chat,
      tree,
      contentStore
    });
  };
  var replaceMessageAndPruneFollowingState = (chats, chatIndex, messageIndex, message, currentContentStore, removeCount = 0) => {
    const state = prepareBranchMutationState(chats, chatIndex, currentContentStore);
    const { tree, contentStore } = state;
    const existingId = tree.activePath[messageIndex];
    state.chat.messages[messageIndex] = message;
    if (existingId)
      setMessageAttributes(tree, existingId, message);
    if (existingId) {
      const oldHash = tree.nodes[existingId].contentHash;
      const newHash = addContentDelta(contentStore, message.content, oldHash);
      releaseContent(contentStore, oldHash);
      tree.nodes[existingId] = {
        ...tree.nodes[existingId],
        role: message.role,
        contentHash: newHash
      };
    } else if (messageIndex === tree.activePath.length) {
      const parentId = messageIndex === 0 ? null : tree.activePath[messageIndex - 1] ?? null;
      const newId = editingUUID();
      tree.nodes[newId] = {
        id: newId,
        parentId,
        role: message.role,
        contentHash: addContent(contentStore, message.content),
        createdAt: Date.now()
      };
      setMessageAttributes(tree, newId, message);
      tree.activePath.push(newId);
    }
    for (let removed = 0; removed < removeCount; removed += 1) {
      removeMessageAtIndexFromPreparedState(state, messageIndex + 1);
    }
    return finalizePreparedBranchMutationState(state);
  };
  var copyBranchSequenceState = (chats, chatIndex, fromNodeId, toNodeId) => {
    const tree = chats[chatIndex]?.branchTree;
    if (!tree?.nodes[fromNodeId] || !tree.nodes[toNodeId])
      return null;
    const nodeIds = [];
    let cur = toNodeId;
    const visited = /* @__PURE__ */ new Set();
    while (cur) {
      if (visited.has(cur) || !tree.nodes[cur])
        return null;
      visited.add(cur);
      nodeIds.unshift(cur);
      if (cur === fromNodeId)
        break;
      cur = tree.nodes[cur]?.parentId ?? null;
    }
    if (nodeIds[0] !== fromNodeId)
      return null;
    const nodes = {};
    nodeIds.forEach((id) => {
      nodes[id] = { ...tree.nodes[id] };
    });
    const clipboard = { nodeIds, sourceChat: chats[chatIndex].id, nodes };
    for (const field of ["collapsedNodes", "omittedNodes", "protectedNodes"]) {
      const source = chats[chatIndex][field];
      if (source)
        clipboard[field] = Object.fromEntries(nodeIds.filter((id) => Object.hasOwn(source, id)).map((id) => [id, source[id]]));
    }
    for (const id of nodeIds)
      copyMessageAttributes(tree, id, clipboard, id);
    return clipboard;
  };
  var removeBranchSequenceState = (chats, chatIndex, nodeIds, currentContentStore) => {
    const contentStore = Object.fromEntries(Object.entries(currentContentStore).map(([hash, entry]) => [hash, { ...entry }]));
    const updatedChats = cloneChatAt(chats, chatIndex);
    const chat = updatedChats[chatIndex];
    captureProjectedMessageAttributes(chat, contentStore);
    const tree = chat.branchTree;
    const removed = new Set(nodeIds);
    for (const node of Object.values(tree.nodes)) {
      if (removed.has(node.id) || !node.parentId || !removed.has(node.parentId))
        continue;
      let parentId = node.parentId;
      while (parentId && removed.has(parentId))
        parentId = tree.nodes[parentId].parentId;
      tree.nodes[node.id] = { ...node, parentId };
    }
    for (const id of nodeIds) {
      releaseContent(contentStore, tree.nodes[id].contentHash);
      deleteMessageAttributes(tree, id);
      delete tree.nodes[id];
    }
    tree.activePath = tree.activePath.filter((id) => !removed.has(id));
    if (tree.activePath.length === 0) {
      const root = Object.values(tree.nodes).find((node) => !node.parentId);
      if (root)
        tree.activePath = buildPathToLeaf(tree, root.id);
    }
    tree.rootId = tree.activePath[0] ?? "";
    chat.messages = materializeActivePath(tree, contentStore);
    return { chats: updatedChats, contentStore };
  };
  var pasteBranchSequenceState = (chats, targetChatIndex, afterNodeId, clipboard, currentContentStore) => {
    const contentStore = Object.fromEntries(Object.entries(currentContentStore).map(([hash, entry]) => [hash, { ...entry }]));
    const updatedChats = cloneChatAt(chats, targetChatIndex);
    captureProjectedMessageAttributes(updatedChats[targetChatIndex], contentStore);
    const tree = updatedChats[targetChatIndex].branchTree;
    const idMap = {};
    clipboard.nodeIds.forEach((id) => {
      idMap[id] = editingUUID();
    });
    for (const field of ["collapsedNodes", "omittedNodes", "protectedNodes"]) {
      const source = clipboard[field];
      if (source && clipboard.nodeIds.some((id) => Object.hasOwn(source, id))) {
        updatedChats[targetChatIndex][field] = { ...updatedChats[targetChatIndex][field], ...Object.fromEntries(clipboard.nodeIds.filter((id) => Object.hasOwn(source, id)).map((id) => [idMap[id], source[id]])) };
      }
    }
    let prevId = afterNodeId;
    for (const origId of clipboard.nodeIds) {
      const newId = idMap[origId];
      const srcNode = clipboard.nodes[origId];
      retainContent(contentStore, srcNode.contentHash);
      tree.nodes[newId] = {
        ...srcNode,
        id: newId,
        parentId: prevId,
        createdAt: Date.now()
      };
      copyMessageAttributes(clipboard, origId, tree, newId);
      prevId = newId;
    }
    const destinationPath = buildPathToLeaf(tree, afterNodeId);
    const insertIdx = destinationPath.indexOf(afterNodeId);
    tree.activePath = [
      ...destinationPath.slice(0, insertIdx + 1),
      ...clipboard.nodeIds.map((id) => idMap[id])
    ];
    tree.rootId = tree.activePath[0] ?? "";
    updatedChats[targetChatIndex].messages = materializeActivePath(tree, contentStore);
    return { chats: updatedChats, contentStore };
  };
  var updateNodeRoleState = (chats, chatIndex, nodeId, role, contentStore) => {
    const updatedChats = cloneChatAt(chats, chatIndex);
    const chat = updatedChats[chatIndex];
    captureProjectedMessageAttributes(chat, contentStore);
    const tree = chat.branchTree;
    const prevRole = tree.nodes[nodeId]?.role;
    tree.nodes[nodeId] = { ...tree.nodes[nodeId], role };
    const isTopNode = tree.activePath[0] === nodeId;
    if (isTopNode) {
      if (prevRole === "system" && role !== "system") {
        chat.config = { ...chat.config, systemPrompt: void 0 };
      } else if (prevRole !== "system" && role === "system") {
        syncBubbleToConfig(chat, tree, contentStore);
      }
    }
    chat.messages = materializeActivePath(tree, contentStore);
    return updatedChats;
  };
  var upsertWithAutoBranchState = (chats, chatIndex, messageIndex, message, currentContentStore) => {
    const { chats: ensuredChats, contentStore: ensuredStore } = ensureBranchReadyState(chats, chatIndex, currentContentStore);
    const tree = ensuredChats[chatIndex].branchTree;
    const existingId = tree.activePath[messageIndex];
    if (!existingId) {
      return upsertMessageAtIndexState(
        ensuredChats,
        chatIndex,
        messageIndex,
        message,
        ensuredStore
      );
    }
    const node = tree.nodes[existingId];
    const contentChanged = !isContentEqual(ensuredStore, node.contentHash, message.content);
    const roleChanged = node.role !== message.role;
    const previousAttributes = JSON.stringify(tree.messageAttributesV1);
    setMessageAttributes(tree, existingId, message);
    const attributesChanged = JSON.stringify(tree.messageAttributesV1) !== previousAttributes;
    if (!contentChanged && !roleChanged && !attributesChanged) {
      return { chats: ensuredChats, contentStore: ensuredStore, noOp: true };
    }
    if (!contentChanged && !roleChanged)
      return { chats: ensuredChats, contentStore: ensuredStore };
    if (!contentChanged) {
      return { chats: updateNodeRoleState(ensuredChats, chatIndex, existingId, message.role, ensuredStore), contentStore: ensuredStore };
    }
    return upsertMessageAtIndexState(
      ensuredChats,
      chatIndex,
      messageIndex,
      message,
      ensuredStore
    );
  };
  var resolveNodeTarget = (chats, input, activeOnly = false) => {
    const chatIndex = chats?.findIndex((chat2) => chat2.id === input.chatId) ?? -1;
    const chat = chats?.[chatIndex];
    if (!chat)
      return { status: "chat-missing" };
    const index = chat.branchTree ? chat.branchTree.activePath.indexOf(input.nodeId) : Number(input.nodeId);
    const exists2 = chat.branchTree ? !!chat.branchTree.nodes[input.nodeId] : Number.isInteger(index) && index >= 0 && String(index) === input.nodeId && !!chat.messages[index];
    if (!exists2)
      return { status: "node-missing" };
    if (activeOnly && index < 0)
      return { status: "invalid-target" };
    return { status: "valid", chatIndex, messageIndex: index, chat };
  };
  var setNodeDisplayFieldState = (chats, input, field, value, contentStore) => {
    const target = resolveNodeTarget(chats, input);
    if (target.status !== "valid")
      return target;
    const ensured = ensureBranchTreeState(chats, target.chatIndex, contentStore);
    const nodeId = target.chat.branchTree ? input.nodeId : ensured.chats[target.chatIndex].branchTree.activePath[target.messageIndex];
    if (ensured.chats[target.chatIndex].branchTree.nodes[nodeId][field] === value)
      return { status: "unchanged" };
    return {
      status: "updated",
      chats: setBranchNodeFieldState(ensured.chats, target.chatIndex, nodeId, field, value),
      contentStore: ensured.contentStore,
      nodeId,
      historyBase: ensured
    };
  };
  var insertNodeState = (chats, input, contentStore) => {
    const chatIndex = chats?.findIndex((chat) => chat.id === input.chatId) ?? -1;
    if (chatIndex < 0)
      return { status: "chat-missing" };
    const target = input.beforeNodeId === null ? null : resolveNodeTarget(chats, { chatId: input.chatId, nodeId: input.beforeNodeId }, true);
    if (target && target.status !== "valid")
      return target;
    const index = target?.messageIndex ?? chats[chatIndex].messages.length;
    const ensured = ensureBranchTreeState(chats, chatIndex, contentStore);
    const result3 = insertMessageAtIndexState(ensured.chats, chatIndex, index, { role: input.role, content: input.content }, ensured.contentStore);
    return { status: "updated", ...result3, nodeId: result3.newId, historyBase: ensured };
  };
  var removeNodeState = (chats, input, contentStore, options) => {
    const target = resolveNodeTarget(chats, input, true);
    if (target.status !== "valid")
      return target;
    if ((target.chat.protectedNodes ?? {})[input.nodeId])
      return { status: "protected" };
    const ensured = ensureBranchReadyState(chats, target.chatIndex, contentStore);
    const result3 = removeMessageAtIndexState(ensured.chats, target.chatIndex, target.messageIndex, ensured.contentStore, options);
    return { status: "updated", ...result3, historyBase: ensured };
  };
  var moveNodeState = (chats, input, contentStore) => {
    const target = resolveNodeTarget(chats, input, true);
    if (target.status !== "valid")
      return target;
    if (input.direction === "up" ? target.messageIndex === 0 : target.messageIndex === target.chat.messages.length - 1)
      return { status: "unchanged" };
    const topRole = target.chat.messages[0]?.role;
    if (topRole === "system" && (target.messageIndex === 0 || input.direction === "up" && target.messageIndex === 1))
      return { status: "unchanged" };
    const ensured = ensureBranchTreeState(chats, target.chatIndex, contentStore);
    const result3 = moveMessageState(ensured.chats, target.chatIndex, target.messageIndex, input.direction, ensured.contentStore);
    return { status: "updated", ...result3, historyBase: ensured };
  };
  var replaceNodeAndPruneState = (chats, input, contentStore) => {
    if (!Number.isInteger(input.removeCount) || input.removeCount < 0)
      return { status: "invalid-input", removedNodeIds: [], pruneBlockedBy: [] };
    const target = resolveNodeTarget(chats, input, true);
    if (target.status !== "valid")
      return { status: "missing", removedNodeIds: [], pruneBlockedBy: [] };
    if (target.chat.protectedNodes?.[input.nodeId])
      return { status: "protected", blockedNodeIds: [input.nodeId], removedNodeIds: [], pruneBlockedBy: [] };
    const ensured = ensureBranchTreeState(chats, target.chatIndex, contentStore);
    const prepared = ensured.chats[target.chatIndex];
    const following = prepared.branchTree.activePath.slice(target.messageIndex + 1, target.messageIndex + 1 + input.removeCount);
    const pruneBlockedBy = following.filter((id) => prepared.protectedNodes?.[id]);
    const result3 = replaceMessageAndPruneFollowingState(ensured.chats, target.chatIndex, target.messageIndex, { role: input.role, content: input.content }, ensured.contentStore, pruneBlockedBy.length ? 0 : input.removeCount);
    return { status: "updated", ...result3, historyBase: ensured, removedNodeIds: pruneBlockedBy.length ? [] : following, pruneBlockedBy };
  };
  var deleteNodeBranchState = (chats, input, contentStore) => {
    const target = resolveNodeTarget(chats, input);
    if (target.status !== "valid")
      return target;
    const blockedNodeIds = target.chat.branchTree ? [...collectDescendants(target.chat.branchTree, input.nodeId)].filter((id) => target.chat.protectedNodes?.[id]) : target.chat.messages.slice(target.messageIndex).map((_23, index) => String(target.messageIndex + index)).filter((id) => target.chat.protectedNodes?.[id]);
    if (blockedNodeIds.length)
      return { status: "protected", blockedNodeIds };
    const ensured = ensureBranchTreeState(chats, target.chatIndex, contentStore);
    const nodeId = target.chat.branchTree ? input.nodeId : ensured.chats[target.chatIndex].branchTree.activePath[target.messageIndex];
    const removedNodeIds = [...collectDescendants(ensured.chats[target.chatIndex].branchTree, nodeId)];
    return { status: "updated", ...deleteBranchState(ensured.chats, target.chatIndex, nodeId, ensured.contentStore), historyBase: ensured, removedNodeIds };
  };

  // src/utils/jsonChanges.ts
  var orderedJSONEqual = (left, right) => {
    if (Object.is(left, right))
      return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right))
      return false;
    const a = Object.keys(left), b = Object.keys(right);
    return a.length === b.length && a.every((key, index) => key === b[index] && orderedJSONEqual(left[key], right[key]));
  };
  function appendChanges(before, after, path, output2) {
    if (orderedJSONEqual(before, after))
      return;
    const opaque = (value) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 1 && Number.isInteger(value.opaqueRef);
    if (opaque(before) || opaque(after)) {
      output2.push({ op: "set", path, value: after });
      return;
    }
    if (Array.isArray(before) && Array.isArray(after)) {
      for (let i = 0; i < after.length; i++) {
        if (i < before.length)
          appendChanges(before[i], after[i], [...path, i], output2);
        else
          output2.push({ op: "set", path: [...path, i], value: after[i] });
      }
      for (let i = before.length - 1; i >= after.length; i--)
        output2.push({ op: "remove", path: [...path, i] });
    } else if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before) && !Array.isArray(after)) {
      for (const key of Object.keys(before))
        if (!Object.hasOwn(after, key))
          output2.push({ op: "remove", path: [...path, key] });
      for (const key of Object.keys(after)) {
        if (Object.hasOwn(before, key))
          appendChanges(before[key], after[key], [...path, key], output2);
        else
          output2.push({ op: "set", path: [...path, key], value: after[key] });
      }
      if (!orderedJSONEqual(Object.keys(before), Object.keys(after)))
        output2.push({ op: "keys", path, keys: Object.keys(after) });
    } else
      output2.push({ op: "set", path, value: after });
  }
  function diffJSONChanges(before, after) {
    const output2 = [];
    appendChanges(before, after, [], output2);
    return output2;
  }

  // shared/google-sync/editing.ts
  var runtime;
  function editingUUID() {
    if (!runtime)
      return crypto.randomUUID();
    const id = runtime.ids.shift();
    if (!id || runtime.reserved.has(id))
      throw new Error("Invalid new node ID.");
    runtime.reserved.add(id);
    return id;
  }
  function withEditingRuntime(newIDs, existingIDs, now, operation) {
    const clock = Date.now;
    runtime = { ids: [...newIDs], reserved: new Set(existingIDs) };
    Date.now = () => now;
    try {
      return operation();
    } finally {
      Date.now = clock;
      runtime = void 0;
    }
  }
  function messageEdit(json, capture) {
    const input = JSON.parse(json);
    if (input.operation === "textValue")
      return JSON.stringify(textValueOf(input.parts));
    if (input.editedText !== void 0 && typeof input.editedText !== "string")
      throw new Error("Invalid text.");
    const parts = input.editedText !== void 0 && input.editedText !== textValueOf(input.parts) ? replaceTextValue(input.parts, input.editedText) : input.parts;
    if (!["user", "assistant", "system"].includes(input.role) || !Array.isArray(input.parts))
      throw new Error("Invalid message.");
    if (input.mode === "append" && input.editedText !== void 0 && !hasMeaningfulContent(parts))
      throw new Error("\u672C\u6587\u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044");
    const before = { chat: input.chat, contentStore: input.contentStore };
    const isolated = structuredClone(before);
    let chat = isolated.chat;
    if (!Array.isArray(chat.messages) && chat.branchTree)
      chat.messages = materializeActivePath(chat.branchTree, isolated.contentStore);
    const wasFlat = !chat.branchTree;
    return withEditingRuntime(input.newIDs, Object.keys(chat.branchTree?.nodes ?? {}), input.now, () => {
      let result3 = input.mode === "insert" && wasFlat ? { chats: [chat], contentStore: isolated.contentStore } : ensureBranchTreeState([chat], 0, isolated.contentStore);
      if (!wasFlat) {
        const path = input.viewingPath;
        if (path.some((id) => !Object.hasOwn(result3.chats[0].branchTree.nodes, id)))
          throw new Error("Invalid viewing path.");
        if (path.length)
          result3.chats = switchActivePathState(result3.chats, 0, path, result3.contentStore);
        else
          result3.chats[0].branchTree.activePath = [];
      }
      let historyBase = result3;
      if (input.mode === "insert") {
        if (input.nodeID === void 0)
          throw new Error("Invalid insert target.");
        const beforeNodeId = wasFlat && input.nodeID?.startsWith("message-") ? input.nodeID.slice(8) : input.nodeID;
        const inserted = insertNodeState(result3.chats, { chatId: chat.id, beforeNodeId, role: input.role, content: parts }, result3.contentStore);
        if (inserted.status !== "updated")
          throw new Error(`Invalid insert target: ${inserted.status}`);
        historyBase = inserted.historyBase ?? historyBase;
        result3 = inserted;
      } else {
        const tree = result3.chats[0].branchTree;
        let index = -1;
        if (input.mode !== "append") {
          const flatID = input.nodeID?.startsWith("message-") ? input.nodeID.slice(8) : input.nodeID;
          index = wasFlat && flatID !== void 0 && String(Number(flatID)) === flatID ? Number(flatID) : tree.activePath.indexOf(input.nodeID);
          if (!Number.isInteger(index) || index < 0 || index >= tree.activePath.length)
            throw new Error("Invalid message node ID.");
          if (input.mode === "overwrite" && result3.chats[0].protectedNodes?.[tree.activePath[index]])
            throw new Error("Protected message.");
        }
        if (input.mode === "append")
          result3 = appendNodeToActivePathState(result3.chats, 0, input.role, parts, result3.contentStore);
        else if (input.mode === "branch") {
          const branch = createBranchState(result3.chats, 0, tree.activePath[index], parts, result3.contentStore);
          result3 = branch;
          if (branch.chats[0].branchTree.nodes[branch.newId].role !== input.role) {
            result3.chats = updateNodeRoleState(branch.chats, 0, branch.newId, input.role, branch.contentStore);
          }
        } else
          result3 = upsertWithAutoBranchState(result3.chats, 0, index, { role: input.role, content: parts }, result3.contentStore);
      }
      const changed = !("noOp" in result3 && result3.noOp);
      for (const [hash, entry] of Object.entries(result3.contentStore)) {
        if (entry.delta && JSON.stringify(entry.delta) !== JSON.stringify(before.contentStore[hash]?.delta)) {
          const content = resolveContent(result3.contentStore, hash);
          const { delta: _delta, ...full } = entry;
          result3.contentStore[hash] = { ...full, content };
        }
      }
      chat = result3.chats[0];
      chat.messages = materializeActivePath(chat.branchTree, result3.contentStore, true);
      if (changed)
        capture?.(historyBase, result3);
      return JSON.stringify(diffJSONChanges(before, JSON.parse(JSON.stringify({ chat, contentStore: result3.contentStore }))));
    });
  }

  // src/store/version.ts
  var STORE_VERSION = 18;

  // src/store/storage/prepareSave.ts
  function findPersistedDataIntegrityErrors(chats, contentStore, clipboard, options = {}) {
    const errors = [];
    const seenChatIds = /* @__PURE__ */ new Set();
    const checkContentHash = (hash, owner) => {
      if (options.allowTransientStreamingHashes && typeof hash === "string" && isStreamingContentHash(hash)) {
        return;
      }
      if (typeof hash !== "string" || !contentStore[hash]) {
        errors.push(`Missing contentHash for ${owner}: ${String(hash)}`);
        return;
      }
      const visited = /* @__PURE__ */ new Set();
      let current = hash;
      while (contentStore[current]?.delta) {
        if (visited.has(current)) {
          errors.push(`Circular delta chain for ${owner}: ${hash}`);
          return;
        }
        visited.add(current);
        current = contentStore[current].delta.baseHash;
        if (!contentStore[current]) {
          errors.push(`Missing delta base for ${owner}: ${current}`);
          return;
        }
      }
    };
    for (const chat of chats) {
      if (!chat || typeof chat.id !== "string" || chat.id.length === 0) {
        errors.push("Chat has an invalid id");
        continue;
      }
      if (seenChatIds.has(chat.id)) {
        errors.push(`Duplicate chat id: ${chat.id}`);
      }
      seenChatIds.add(chat.id);
      if (!chat.branchTree)
        continue;
      if (!chat.branchTree.nodes || typeof chat.branchTree.nodes !== "object" || Array.isArray(chat.branchTree.nodes)) {
        errors.push(`Invalid branchTree nodes: ${chat.id}`);
        continue;
      }
      for (const node of Object.values(chat.branchTree.nodes)) {
        checkContentHash(node?.contentHash, `chat ${chat.id}`);
      }
    }
    if (clipboard && (!clipboard.nodes || typeof clipboard.nodes !== "object" || Array.isArray(clipboard.nodes))) {
      errors.push("Invalid branch clipboard nodes");
    } else if (clipboard?.nodes) {
      for (const node of Object.values(clipboard.nodes)) {
        checkContentHash(node?.contentHash, "branch clipboard");
      }
    }
    return errors;
  }

  // src/utils/folderHierarchy.ts
  function validateFolderHierarchy(folders) {
    if (!folders || typeof folders !== "object" || Array.isArray(folders))
      return false;
    const collection = folders;
    for (const [id, folder] of Object.entries(collection)) {
      if (!id || !folder || typeof folder !== "object" || folder.id !== id || typeof folder.name !== "string" || !Number.isFinite(folder.order) || typeof folder.expanded !== "boolean" || folder.parentId != null && (typeof folder.parentId !== "string" || !Object.hasOwn(collection, folder.parentId)))
        return false;
    }
    const finished = /* @__PURE__ */ new Set();
    for (const id of Object.keys(collection)) {
      const path = /* @__PURE__ */ new Set();
      let current = id;
      while (current !== void 0 && !finished.has(current)) {
        if (path.has(current))
          return false;
        path.add(current);
        current = collection[current].parentId ?? void 0;
      }
      for (const member of path)
        finished.add(member);
    }
    return true;
  }
  function getFolderParentId(folders, id) {
    const parent = folders[id]?.parentId ?? void 0;
    const visited = /* @__PURE__ */ new Set([id]);
    let current = parent;
    while (current !== void 0) {
      if (visited.has(current) || !Object.hasOwn(folders, current))
        return void 0;
      visited.add(current);
      current = folders[current]?.parentId ?? void 0;
    }
    return parent;
  }
  function getFolderAncestors(folders, id) {
    const result3 = [];
    const visited = /* @__PURE__ */ new Set();
    let current = id;
    while (current !== void 0 && Object.hasOwn(folders, current) && !visited.has(current)) {
      visited.add(current);
      result3.push(current);
      current = result3.length === 1 ? getFolderParentId(folders, current) : folders[current]?.parentId ?? void 0;
    }
    return result3;
  }
  function getFolderSubtreeIds(folders, id) {
    if (!Object.hasOwn(folders, id))
      return [];
    const children = /* @__PURE__ */ new Map();
    for (const [childId, folder] of Object.entries(folders)) {
      if (folder?.parentId != null) {
        const list = children.get(folder.parentId) ?? [];
        list.push(childId);
        children.set(folder.parentId, list);
      }
    }
    const result3 = [], visited = /* @__PURE__ */ new Set(), pending = [id];
    while (pending.length) {
      const current = pending.pop();
      if (visited.has(current))
        continue;
      visited.add(current);
      result3.push(current);
      for (const child of children.get(current) ?? [])
        pending.push(child);
    }
    return result3;
  }

  // src/utils/bubbleSummary.ts
  var normalizeBubbleSummaryText = (text) => {
    const trimmed = text.trim();
    const json = trimmed.replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
    try {
      const value = JSON.parse(json);
      if (typeof value === "string")
        return value.trim();
      const messages = Array.isArray(value) ? value : [value];
      if (messages.length && messages.every((message) => message && typeof message === "object" && (message.role === "user" || message.role === "assistant") && typeof message.content === "string")) {
        return messages.map((message) => message.role === "assistant" ? `\u30A2\u30B7\u30B9\u30BF\u30F3\u30C8\uFF1A
${message.content}` : message.content).join("\n\n").trim();
      }
    } catch {
    }
    return trimmed;
  };
  var textParts = (message) => {
    if (!message?.content?.length || !message.content.every(isTextContent))
      return null;
    const parts = message.content.map((value) => value.text);
    return parts.some((part) => part.trim()) ? parts : null;
  };
  var hasTool = (message) => !!message?.content?.some((value) => isToolCallContent(value) || isToolResultContent(value));
  var equalParts = (left, right) => left.length === right.length && left.every((part, index) => part === right[index]);
  var validGeneration = (value) => {
    if (value === void 0)
      return true;
    const generation = value;
    return !!generation && typeof generation === "object" && typeof generation.model === "string" && (generation.providerId === void 0 || typeof generation.providerId === "string") && Number.isFinite(generation.createdAt) && !!generation.settings && typeof generation.settings === "object" && Number.isFinite(generation.settings.temperature) && Number.isFinite(generation.settings.max_tokens) && (generation.settings.reasoning_effort === void 0 || typeof generation.settings.reasoning_effort === "string");
  };
  var isBubbleSummary = (value) => !!value && typeof value === "object" && typeof value.id === "string" && (value.mode === "single" || value.mode === "through" || value.mode === "range") && typeof value.text === "string" && typeof value.useForSubmit === "boolean" && (value.format === void 0 || value.format === "compact") && validGeneration(value.generation) && Array.isArray(value.sources) && value.sources.every((source) => !!source && typeof source.nodeId === "string" && (source.parentId === null || typeof source.parentId === "string") && (source.role === "user" || source.role === "assistant") && Array.isArray(source.textParts) && source.textParts.every((part) => typeof part === "string"));
  var isSummaryEligible = (message) => !!message && (message.role === "user" || message.role === "assistant") && textParts(message) !== null && !hasTool(message);
  var resolveValidSummary = (chat, summary, generatingNodeIds = []) => {
    if (!isBubbleSummary(summary))
      return null;
    const candidate = summary, path = chat.branchTree?.activePath ?? chat.messages.map((_23, index) => String(index));
    if (typeof candidate.text !== "string" || !candidate.text.trim() || !Array.isArray(candidate.sources) || !candidate.sources.length)
      return null;
    const indices = candidate.sources.map((source) => path.indexOf(source?.nodeId));
    if (indices.some((index) => index < 0) || new Set(indices).size !== indices.length)
      return null;
    const first = Math.min(...indices), last = Math.max(...indices);
    if (last - first + 1 !== indices.length)
      return null;
    for (let offset = 0; offset < candidate.sources.length; offset++) {
      const index = first + offset, source = candidate.sources[offset], nodeId = path[index];
      const node = chat.branchTree?.nodes[nodeId], message = chat.messages[index], parts = textParts(message);
      if (!source || source.nodeId !== nodeId || generatingNodeIds.includes(nodeId) || !isSummaryEligible(message) || !parts || message.role !== source.role || !Array.isArray(source.textParts) || !equalParts(parts, source.textParts) || (node?.parentId ?? null) !== source.parentId)
        return null;
    }
    return { first, last };
  };
  var getAppliedBubbleSummaries = (chat, messageIndex = chat.messages.length, generatingNodeIds = []) => {
    const candidates = (Array.isArray(chat.summaries) ? chat.summaries : []).filter((summary) => summary?.useForSubmit).map((summary) => ({ summary, range: resolveValidSummary(chat, summary, generatingNodeIds) })).filter((value) => !!value.range && value.range.last < messageIndex);
    const accepted = candidates.filter((candidate) => !candidates.some((other) => other !== candidate && candidate.range.first <= other.range.last && other.range.first <= candidate.range.last));
    return accepted;
  };
  var bubbleSummarySubmitMessage = (summary) => ({ role: "user", content: [{ type: "text", text: `${summary.format === "compact" ? "Retained conversation context. Answer the latest request using the requirements and state below. Follow the retained language, tone, structure and length requirements and examples, not formatting added for this summary. Adoption and plans do not imply execution; preserve uncertainty about what has been done.\n" : "Past conversation summary:\n"}${normalizeBubbleSummaryText(summary.text)}` }] });
  var applyBubbleSummariesForSubmit = (chat, messageIndex, generatingNodeIds = []) => {
    const source = chat.messages.slice(0, messageIndex), path = chat.branchTree?.activePath ?? source.map((_23, index) => String(index));
    const accepted = getAppliedBubbleSummaries(chat, messageIndex, generatingNodeIds).filter(({ summary }) => !summary.sources.some((source2) => chat.omittedNodes?.[source2.nodeId]));
    const starts = new Map(accepted.map((value) => [value.range.first, value]));
    const result3 = [];
    for (let index = 0; index < source.length; index++) {
      const replacement = starts.get(index);
      if (replacement) {
        result3.push(bubbleSummarySubmitMessage(replacement.summary));
        index = replacement.range.last;
        continue;
      }
      if (chat.omittedNodes?.[path[index]] && !hasTool(source[index]))
        continue;
      result3.push(source[index]);
    }
    return result3;
  };

  // src/constants/chatDefaults.ts
  var defaultSystemMessage = "You are a large language model assistant.\nCarefully heed the user's instructions. \nRespond using Markdown.";
  var defaultModel = "";
  var defaultUserMaxToken = 4e3;
  var _defaultChatConfig = {
    model: defaultModel,
    max_tokens: defaultUserMaxToken,
    temperature: 1,
    presence_penalty: 0,
    top_p: 1,
    frequency_penalty: 0,
    stream: true,
    reasoning_effort: "none",
    reasoning_budget_tokens: 0
  };
  var _defaultImageDetail = "auto";

  // src/utils/chatIdentity.ts
  var ensureUniqueChatIds = (chats) => {
    const seen = /* @__PURE__ */ new Set();
    let changed = false;
    chats.forEach((chat) => {
      const hasValidId = typeof chat.id === "string" && chat.id.length > 0;
      if (!hasValidId || seen.has(chat.id)) {
        chat.id = editingUUID();
        changed = true;
      }
      seen.add(chat.id);
    });
    return changed;
  };
  var assignFreshChatIds = (chats) => {
    chats.forEach((chat) => {
      chat.id = editingUUID();
    });
  };

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/typeof.js
  function _typeof(obj) {
    "@babel/helpers - typeof";
    return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(obj2) {
      return typeof obj2;
    } : function(obj2) {
      return obj2 && "function" == typeof Symbol && obj2.constructor === Symbol && obj2 !== Symbol.prototype ? "symbol" : typeof obj2;
    }, _typeof(obj);
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/classCallCheck.js
  function _classCallCheck(instance2, Constructor) {
    if (!(instance2 instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/toPrimitive.js
  function _toPrimitive(input, hint) {
    if (_typeof(input) !== "object" || input === null)
      return input;
    var prim = input[Symbol.toPrimitive];
    if (prim !== void 0) {
      var res = prim.call(input, hint || "default");
      if (_typeof(res) !== "object")
        return res;
      throw new TypeError("@@toPrimitive must return a primitive value.");
    }
    return (hint === "string" ? String : Number)(input);
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/toPropertyKey.js
  function _toPropertyKey(arg) {
    var key = _toPrimitive(arg, "string");
    return _typeof(key) === "symbol" ? key : String(key);
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/createClass.js
  function _defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor)
        descriptor.writable = true;
      Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor);
    }
  }
  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps)
      _defineProperties(Constructor.prototype, protoProps);
    if (staticProps)
      _defineProperties(Constructor, staticProps);
    Object.defineProperty(Constructor, "prototype", {
      writable: false
    });
    return Constructor;
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/assertThisInitialized.js
  function _assertThisInitialized(self2) {
    if (self2 === void 0) {
      throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }
    return self2;
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/setPrototypeOf.js
  function _setPrototypeOf(o, p) {
    _setPrototypeOf = Object.setPrototypeOf ? Object.setPrototypeOf.bind() : function _setPrototypeOf2(o2, p2) {
      o2.__proto__ = p2;
      return o2;
    };
    return _setPrototypeOf(o, p);
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/inherits.js
  function _inherits(subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
      throw new TypeError("Super expression must either be null or a function");
    }
    subClass.prototype = Object.create(superClass && superClass.prototype, {
      constructor: {
        value: subClass,
        writable: true,
        configurable: true
      }
    });
    Object.defineProperty(subClass, "prototype", {
      writable: false
    });
    if (superClass)
      _setPrototypeOf(subClass, superClass);
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/possibleConstructorReturn.js
  function _possibleConstructorReturn(self2, call) {
    if (call && (_typeof(call) === "object" || typeof call === "function")) {
      return call;
    } else if (call !== void 0) {
      throw new TypeError("Derived constructors may only return object or undefined");
    }
    return _assertThisInitialized(self2);
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/getPrototypeOf.js
  function _getPrototypeOf(o) {
    _getPrototypeOf = Object.setPrototypeOf ? Object.getPrototypeOf.bind() : function _getPrototypeOf2(o2) {
      return o2.__proto__ || Object.getPrototypeOf(o2);
    };
    return _getPrototypeOf(o);
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/defineProperty.js
  function _defineProperty(obj, key, value) {
    key = _toPropertyKey(key);
    if (key in obj) {
      Object.defineProperty(obj, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      });
    } else {
      obj[key] = value;
    }
    return obj;
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/arrayWithHoles.js
  function _arrayWithHoles(arr) {
    if (Array.isArray(arr))
      return arr;
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/iterableToArray.js
  function _iterableToArray(iter) {
    if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null)
      return Array.from(iter);
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/arrayLikeToArray.js
  function _arrayLikeToArray(arr, len) {
    if (len == null || len > arr.length)
      len = arr.length;
    for (var i = 0, arr2 = new Array(len); i < len; i++)
      arr2[i] = arr[i];
    return arr2;
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/unsupportedIterableToArray.js
  function _unsupportedIterableToArray(o, minLen) {
    if (!o)
      return;
    if (typeof o === "string")
      return _arrayLikeToArray(o, minLen);
    var n = Object.prototype.toString.call(o).slice(8, -1);
    if (n === "Object" && o.constructor)
      n = o.constructor.name;
    if (n === "Map" || n === "Set")
      return Array.from(o);
    if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n))
      return _arrayLikeToArray(o, minLen);
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/nonIterableRest.js
  function _nonIterableRest() {
    throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/@babel/runtime/helpers/esm/toArray.js
  function _toArray(arr) {
    return _arrayWithHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableRest();
  }

  // ../../../Users/suzuki/weavelet-canvas/node_modules/i18next/dist/esm/i18next.js
  function ownKeys$6(object2, enumerableOnly) {
    var keys = Object.keys(object2);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object2);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object2, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread$6(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2 ? ownKeys$6(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys$6(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  var consoleLogger = {
    type: "logger",
    log: function log(args) {
      this.output("log", args);
    },
    warn: function warn(args) {
      this.output("warn", args);
    },
    error: function error(args) {
      this.output("error", args);
    },
    output: function output(type, args) {
      if (console && console[type])
        console[type].apply(console, args);
    }
  };
  var Logger = function() {
    function Logger2(concreteLogger) {
      var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      _classCallCheck(this, Logger2);
      this.init(concreteLogger, options);
    }
    _createClass(Logger2, [{
      key: "init",
      value: function init2(concreteLogger) {
        var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
        this.prefix = options.prefix || "i18next:";
        this.logger = concreteLogger || consoleLogger;
        this.options = options;
        this.debug = options.debug;
      }
    }, {
      key: "setDebug",
      value: function setDebug(bool) {
        this.debug = bool;
      }
    }, {
      key: "log",
      value: function log2() {
        for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
        }
        return this.forward(args, "log", "", true);
      }
    }, {
      key: "warn",
      value: function warn2() {
        for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
          args[_key2] = arguments[_key2];
        }
        return this.forward(args, "warn", "", true);
      }
    }, {
      key: "error",
      value: function error2() {
        for (var _len3 = arguments.length, args = new Array(_len3), _key3 = 0; _key3 < _len3; _key3++) {
          args[_key3] = arguments[_key3];
        }
        return this.forward(args, "error", "");
      }
    }, {
      key: "deprecate",
      value: function deprecate() {
        for (var _len4 = arguments.length, args = new Array(_len4), _key4 = 0; _key4 < _len4; _key4++) {
          args[_key4] = arguments[_key4];
        }
        return this.forward(args, "warn", "WARNING DEPRECATED: ", true);
      }
    }, {
      key: "forward",
      value: function forward(args, lvl, prefix, debugOnly) {
        if (debugOnly && !this.debug)
          return null;
        if (typeof args[0] === "string")
          args[0] = "".concat(prefix).concat(this.prefix, " ").concat(args[0]);
        return this.logger[lvl](args);
      }
    }, {
      key: "create",
      value: function create(moduleName) {
        return new Logger2(this.logger, _objectSpread$6(_objectSpread$6({}, {
          prefix: "".concat(this.prefix, ":").concat(moduleName, ":")
        }), this.options));
      }
    }, {
      key: "clone",
      value: function clone2(options) {
        options = options || this.options;
        options.prefix = options.prefix || this.prefix;
        return new Logger2(this.logger, options);
      }
    }]);
    return Logger2;
  }();
  var baseLogger = new Logger();
  var EventEmitter = function() {
    function EventEmitter2() {
      _classCallCheck(this, EventEmitter2);
      this.observers = {};
    }
    _createClass(EventEmitter2, [{
      key: "on",
      value: function on(events, listener) {
        var _this = this;
        events.split(" ").forEach(function(event) {
          _this.observers[event] = _this.observers[event] || [];
          _this.observers[event].push(listener);
        });
        return this;
      }
    }, {
      key: "off",
      value: function off(event, listener) {
        if (!this.observers[event])
          return;
        if (!listener) {
          delete this.observers[event];
          return;
        }
        this.observers[event] = this.observers[event].filter(function(l) {
          return l !== listener;
        });
      }
    }, {
      key: "emit",
      value: function emit(event) {
        for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
          args[_key - 1] = arguments[_key];
        }
        if (this.observers[event]) {
          var cloned = [].concat(this.observers[event]);
          cloned.forEach(function(observer) {
            observer.apply(void 0, args);
          });
        }
        if (this.observers["*"]) {
          var _cloned = [].concat(this.observers["*"]);
          _cloned.forEach(function(observer) {
            observer.apply(observer, [event].concat(args));
          });
        }
      }
    }]);
    return EventEmitter2;
  }();
  function defer() {
    var res;
    var rej;
    var promise = new Promise(function(resolve, reject) {
      res = resolve;
      rej = reject;
    });
    promise.resolve = res;
    promise.reject = rej;
    return promise;
  }
  function makeString(object2) {
    if (object2 == null)
      return "";
    return "" + object2;
  }
  function copy(a, s, t2) {
    a.forEach(function(m) {
      if (s[m])
        t2[m] = s[m];
    });
  }
  function getLastOfPath(object2, path, Empty) {
    function cleanKey(key2) {
      return key2 && key2.indexOf("###") > -1 ? key2.replace(/###/g, ".") : key2;
    }
    function canNotTraverseDeeper() {
      return !object2 || typeof object2 === "string";
    }
    var stack = typeof path !== "string" ? [].concat(path) : path.split(".");
    while (stack.length > 1) {
      if (canNotTraverseDeeper())
        return {};
      var key = cleanKey(stack.shift());
      if (!object2[key] && Empty)
        object2[key] = new Empty();
      if (Object.prototype.hasOwnProperty.call(object2, key)) {
        object2 = object2[key];
      } else {
        object2 = {};
      }
    }
    if (canNotTraverseDeeper())
      return {};
    return {
      obj: object2,
      k: cleanKey(stack.shift())
    };
  }
  function setPath(object2, path, newValue) {
    var _getLastOfPath = getLastOfPath(object2, path, Object), obj = _getLastOfPath.obj, k = _getLastOfPath.k;
    obj[k] = newValue;
  }
  function pushPath(object2, path, newValue, concat) {
    var _getLastOfPath2 = getLastOfPath(object2, path, Object), obj = _getLastOfPath2.obj, k = _getLastOfPath2.k;
    obj[k] = obj[k] || [];
    if (concat)
      obj[k] = obj[k].concat(newValue);
    if (!concat)
      obj[k].push(newValue);
  }
  function getPath(object2, path) {
    var _getLastOfPath3 = getLastOfPath(object2, path), obj = _getLastOfPath3.obj, k = _getLastOfPath3.k;
    if (!obj)
      return void 0;
    return obj[k];
  }
  function getPathWithDefaults(data, defaultData, key) {
    var value = getPath(data, key);
    if (value !== void 0) {
      return value;
    }
    return getPath(defaultData, key);
  }
  function deepExtend(target, source, overwrite) {
    for (var prop in source) {
      if (prop !== "__proto__" && prop !== "constructor") {
        if (prop in target) {
          if (typeof target[prop] === "string" || target[prop] instanceof String || typeof source[prop] === "string" || source[prop] instanceof String) {
            if (overwrite)
              target[prop] = source[prop];
          } else {
            deepExtend(target[prop], source[prop], overwrite);
          }
        } else {
          target[prop] = source[prop];
        }
      }
    }
    return target;
  }
  function regexEscape(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
  }
  var _entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#x2F;"
  };
  function escape(data) {
    if (typeof data === "string") {
      return data.replace(/[&<>"'\/]/g, function(s) {
        return _entityMap[s];
      });
    }
    return data;
  }
  var isIE10 = typeof window !== "undefined" && window.navigator && typeof window.navigator.userAgentData === "undefined" && window.navigator.userAgent && window.navigator.userAgent.indexOf("MSIE") > -1;
  var chars = [" ", ",", "?", "!", ";"];
  function looksLikeObjectPath(key, nsSeparator, keySeparator) {
    nsSeparator = nsSeparator || "";
    keySeparator = keySeparator || "";
    var possibleChars = chars.filter(function(c) {
      return nsSeparator.indexOf(c) < 0 && keySeparator.indexOf(c) < 0;
    });
    if (possibleChars.length === 0)
      return true;
    var r = new RegExp("(".concat(possibleChars.map(function(c) {
      return c === "?" ? "\\?" : c;
    }).join("|"), ")"));
    var matched = !r.test(key);
    if (!matched) {
      var ki = key.indexOf(keySeparator);
      if (ki > 0 && !r.test(key.substring(0, ki))) {
        matched = true;
      }
    }
    return matched;
  }
  function ownKeys$5(object2, enumerableOnly) {
    var keys = Object.keys(object2);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object2);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object2, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread$5(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2 ? ownKeys$5(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys$5(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  function _createSuper$3(Derived) {
    var hasNativeReflectConstruct = _isNativeReflectConstruct$3();
    return function _createSuperInternal() {
      var Super = _getPrototypeOf(Derived), result3;
      if (hasNativeReflectConstruct) {
        var NewTarget = _getPrototypeOf(this).constructor;
        result3 = Reflect.construct(Super, arguments, NewTarget);
      } else {
        result3 = Super.apply(this, arguments);
      }
      return _possibleConstructorReturn(this, result3);
    };
  }
  function _isNativeReflectConstruct$3() {
    if (typeof Reflect === "undefined" || !Reflect.construct)
      return false;
    if (Reflect.construct.sham)
      return false;
    if (typeof Proxy === "function")
      return true;
    try {
      Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
      }));
      return true;
    } catch (e) {
      return false;
    }
  }
  function deepFind(obj, path) {
    var keySeparator = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : ".";
    if (!obj)
      return void 0;
    if (obj[path])
      return obj[path];
    var paths = path.split(keySeparator);
    var current = obj;
    for (var i = 0; i < paths.length; ++i) {
      if (!current)
        return void 0;
      if (typeof current[paths[i]] === "string" && i + 1 < paths.length) {
        return void 0;
      }
      if (current[paths[i]] === void 0) {
        var j = 2;
        var p = paths.slice(i, i + j).join(keySeparator);
        var mix = current[p];
        while (mix === void 0 && paths.length > i + j) {
          j++;
          p = paths.slice(i, i + j).join(keySeparator);
          mix = current[p];
        }
        if (mix === void 0)
          return void 0;
        if (mix === null)
          return null;
        if (path.endsWith(p)) {
          if (typeof mix === "string")
            return mix;
          if (p && typeof mix[p] === "string")
            return mix[p];
        }
        var joinedPath = paths.slice(i + j).join(keySeparator);
        if (joinedPath)
          return deepFind(mix, joinedPath, keySeparator);
        return void 0;
      }
      current = current[paths[i]];
    }
    return current;
  }
  var ResourceStore = function(_EventEmitter) {
    _inherits(ResourceStore2, _EventEmitter);
    var _super = _createSuper$3(ResourceStore2);
    function ResourceStore2(data) {
      var _this;
      var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {
        ns: ["translation"],
        defaultNS: "translation"
      };
      _classCallCheck(this, ResourceStore2);
      _this = _super.call(this);
      if (isIE10) {
        EventEmitter.call(_assertThisInitialized(_this));
      }
      _this.data = data || {};
      _this.options = options;
      if (_this.options.keySeparator === void 0) {
        _this.options.keySeparator = ".";
      }
      if (_this.options.ignoreJSONStructure === void 0) {
        _this.options.ignoreJSONStructure = true;
      }
      return _this;
    }
    _createClass(ResourceStore2, [{
      key: "addNamespaces",
      value: function addNamespaces(ns) {
        if (this.options.ns.indexOf(ns) < 0) {
          this.options.ns.push(ns);
        }
      }
    }, {
      key: "removeNamespaces",
      value: function removeNamespaces(ns) {
        var index = this.options.ns.indexOf(ns);
        if (index > -1) {
          this.options.ns.splice(index, 1);
        }
      }
    }, {
      key: "getResource",
      value: function getResource(lng, ns, key) {
        var options = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {};
        var keySeparator = options.keySeparator !== void 0 ? options.keySeparator : this.options.keySeparator;
        var ignoreJSONStructure = options.ignoreJSONStructure !== void 0 ? options.ignoreJSONStructure : this.options.ignoreJSONStructure;
        var path = [lng, ns];
        if (key && typeof key !== "string")
          path = path.concat(key);
        if (key && typeof key === "string")
          path = path.concat(keySeparator ? key.split(keySeparator) : key);
        if (lng.indexOf(".") > -1) {
          path = lng.split(".");
        }
        var result3 = getPath(this.data, path);
        if (result3 || !ignoreJSONStructure || typeof key !== "string")
          return result3;
        return deepFind(this.data && this.data[lng] && this.data[lng][ns], key, keySeparator);
      }
    }, {
      key: "addResource",
      value: function addResource(lng, ns, key, value) {
        var options = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : {
          silent: false
        };
        var keySeparator = this.options.keySeparator;
        if (keySeparator === void 0)
          keySeparator = ".";
        var path = [lng, ns];
        if (key)
          path = path.concat(keySeparator ? key.split(keySeparator) : key);
        if (lng.indexOf(".") > -1) {
          path = lng.split(".");
          value = ns;
          ns = path[1];
        }
        this.addNamespaces(ns);
        setPath(this.data, path, value);
        if (!options.silent)
          this.emit("added", lng, ns, key, value);
      }
    }, {
      key: "addResources",
      value: function addResources(lng, ns, resources) {
        var options = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {
          silent: false
        };
        for (var m in resources) {
          if (typeof resources[m] === "string" || Object.prototype.toString.apply(resources[m]) === "[object Array]")
            this.addResource(lng, ns, m, resources[m], {
              silent: true
            });
        }
        if (!options.silent)
          this.emit("added", lng, ns, resources);
      }
    }, {
      key: "addResourceBundle",
      value: function addResourceBundle(lng, ns, resources, deep, overwrite) {
        var options = arguments.length > 5 && arguments[5] !== void 0 ? arguments[5] : {
          silent: false
        };
        var path = [lng, ns];
        if (lng.indexOf(".") > -1) {
          path = lng.split(".");
          deep = resources;
          resources = ns;
          ns = path[1];
        }
        this.addNamespaces(ns);
        var pack = getPath(this.data, path) || {};
        if (deep) {
          deepExtend(pack, resources, overwrite);
        } else {
          pack = _objectSpread$5(_objectSpread$5({}, pack), resources);
        }
        setPath(this.data, path, pack);
        if (!options.silent)
          this.emit("added", lng, ns, resources);
      }
    }, {
      key: "removeResourceBundle",
      value: function removeResourceBundle(lng, ns) {
        if (this.hasResourceBundle(lng, ns)) {
          delete this.data[lng][ns];
        }
        this.removeNamespaces(ns);
        this.emit("removed", lng, ns);
      }
    }, {
      key: "hasResourceBundle",
      value: function hasResourceBundle(lng, ns) {
        return this.getResource(lng, ns) !== void 0;
      }
    }, {
      key: "getResourceBundle",
      value: function getResourceBundle(lng, ns) {
        if (!ns)
          ns = this.options.defaultNS;
        if (this.options.compatibilityAPI === "v1")
          return _objectSpread$5(_objectSpread$5({}, {}), this.getResource(lng, ns));
        return this.getResource(lng, ns);
      }
    }, {
      key: "getDataByLanguage",
      value: function getDataByLanguage(lng) {
        return this.data[lng];
      }
    }, {
      key: "hasLanguageSomeTranslations",
      value: function hasLanguageSomeTranslations(lng) {
        var data = this.getDataByLanguage(lng);
        var n = data && Object.keys(data) || [];
        return !!n.find(function(v) {
          return data[v] && Object.keys(data[v]).length > 0;
        });
      }
    }, {
      key: "toJSON",
      value: function toJSON() {
        return this.data;
      }
    }]);
    return ResourceStore2;
  }(EventEmitter);
  var postProcessor = {
    processors: {},
    addPostProcessor: function addPostProcessor(module) {
      this.processors[module.name] = module;
    },
    handle: function handle(processors, value, key, options, translator) {
      var _this = this;
      processors.forEach(function(processor) {
        if (_this.processors[processor])
          value = _this.processors[processor].process(value, key, options, translator);
      });
      return value;
    }
  };
  function ownKeys$4(object2, enumerableOnly) {
    var keys = Object.keys(object2);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object2);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object2, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread$4(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2 ? ownKeys$4(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys$4(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  function _createSuper$2(Derived) {
    var hasNativeReflectConstruct = _isNativeReflectConstruct$2();
    return function _createSuperInternal() {
      var Super = _getPrototypeOf(Derived), result3;
      if (hasNativeReflectConstruct) {
        var NewTarget = _getPrototypeOf(this).constructor;
        result3 = Reflect.construct(Super, arguments, NewTarget);
      } else {
        result3 = Super.apply(this, arguments);
      }
      return _possibleConstructorReturn(this, result3);
    };
  }
  function _isNativeReflectConstruct$2() {
    if (typeof Reflect === "undefined" || !Reflect.construct)
      return false;
    if (Reflect.construct.sham)
      return false;
    if (typeof Proxy === "function")
      return true;
    try {
      Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
      }));
      return true;
    } catch (e) {
      return false;
    }
  }
  var checkedLoadedFor = {};
  var Translator = function(_EventEmitter) {
    _inherits(Translator2, _EventEmitter);
    var _super = _createSuper$2(Translator2);
    function Translator2(services) {
      var _this;
      var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      _classCallCheck(this, Translator2);
      _this = _super.call(this);
      if (isIE10) {
        EventEmitter.call(_assertThisInitialized(_this));
      }
      copy(["resourceStore", "languageUtils", "pluralResolver", "interpolator", "backendConnector", "i18nFormat", "utils"], services, _assertThisInitialized(_this));
      _this.options = options;
      if (_this.options.keySeparator === void 0) {
        _this.options.keySeparator = ".";
      }
      _this.logger = baseLogger.create("translator");
      return _this;
    }
    _createClass(Translator2, [{
      key: "changeLanguage",
      value: function changeLanguage2(lng) {
        if (lng)
          this.language = lng;
      }
    }, {
      key: "exists",
      value: function exists2(key) {
        var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {
          interpolation: {}
        };
        if (key === void 0 || key === null) {
          return false;
        }
        var resolved = this.resolve(key, options);
        return resolved && resolved.res !== void 0;
      }
    }, {
      key: "extractFromKey",
      value: function extractFromKey(key, options) {
        var nsSeparator = options.nsSeparator !== void 0 ? options.nsSeparator : this.options.nsSeparator;
        if (nsSeparator === void 0)
          nsSeparator = ":";
        var keySeparator = options.keySeparator !== void 0 ? options.keySeparator : this.options.keySeparator;
        var namespaces = options.ns || this.options.defaultNS || [];
        var wouldCheckForNsInKey = nsSeparator && key.indexOf(nsSeparator) > -1;
        var seemsNaturalLanguage = !this.options.userDefinedKeySeparator && !options.keySeparator && !this.options.userDefinedNsSeparator && !options.nsSeparator && !looksLikeObjectPath(key, nsSeparator, keySeparator);
        if (wouldCheckForNsInKey && !seemsNaturalLanguage) {
          var m = key.match(this.interpolator.nestingRegexp);
          if (m && m.length > 0) {
            return {
              key,
              namespaces
            };
          }
          var parts = key.split(nsSeparator);
          if (nsSeparator !== keySeparator || nsSeparator === keySeparator && this.options.ns.indexOf(parts[0]) > -1)
            namespaces = parts.shift();
          key = parts.join(keySeparator);
        }
        if (typeof namespaces === "string")
          namespaces = [namespaces];
        return {
          key,
          namespaces
        };
      }
    }, {
      key: "translate",
      value: function translate(keys, options, lastKey) {
        var _this2 = this;
        if (_typeof(options) !== "object" && this.options.overloadTranslationOptionHandler) {
          options = this.options.overloadTranslationOptionHandler(arguments);
        }
        if (!options)
          options = {};
        if (keys === void 0 || keys === null)
          return "";
        if (!Array.isArray(keys))
          keys = [String(keys)];
        var returnDetails = options.returnDetails !== void 0 ? options.returnDetails : this.options.returnDetails;
        var keySeparator = options.keySeparator !== void 0 ? options.keySeparator : this.options.keySeparator;
        var _this$extractFromKey = this.extractFromKey(keys[keys.length - 1], options), key = _this$extractFromKey.key, namespaces = _this$extractFromKey.namespaces;
        var namespace = namespaces[namespaces.length - 1];
        var lng = options.lng || this.language;
        var appendNamespaceToCIMode = options.appendNamespaceToCIMode || this.options.appendNamespaceToCIMode;
        if (lng && lng.toLowerCase() === "cimode") {
          if (appendNamespaceToCIMode) {
            var nsSeparator = options.nsSeparator || this.options.nsSeparator;
            if (returnDetails) {
              return {
                res: "".concat(namespace).concat(nsSeparator).concat(key),
                usedKey: key,
                exactUsedKey: key,
                usedLng: lng,
                usedNS: namespace
              };
            }
            return "".concat(namespace).concat(nsSeparator).concat(key);
          }
          if (returnDetails) {
            return {
              res: key,
              usedKey: key,
              exactUsedKey: key,
              usedLng: lng,
              usedNS: namespace
            };
          }
          return key;
        }
        var resolved = this.resolve(keys, options);
        var res = resolved && resolved.res;
        var resUsedKey = resolved && resolved.usedKey || key;
        var resExactUsedKey = resolved && resolved.exactUsedKey || key;
        var resType = Object.prototype.toString.apply(res);
        var noObject = ["[object Number]", "[object Function]", "[object RegExp]"];
        var joinArrays = options.joinArrays !== void 0 ? options.joinArrays : this.options.joinArrays;
        var handleAsObjectInI18nFormat = !this.i18nFormat || this.i18nFormat.handleAsObject;
        var handleAsObject = typeof res !== "string" && typeof res !== "boolean" && typeof res !== "number";
        if (handleAsObjectInI18nFormat && res && handleAsObject && noObject.indexOf(resType) < 0 && !(typeof joinArrays === "string" && resType === "[object Array]")) {
          if (!options.returnObjects && !this.options.returnObjects) {
            if (!this.options.returnedObjectHandler) {
              this.logger.warn("accessing an object - but returnObjects options is not enabled!");
            }
            var r = this.options.returnedObjectHandler ? this.options.returnedObjectHandler(resUsedKey, res, _objectSpread$4(_objectSpread$4({}, options), {}, {
              ns: namespaces
            })) : "key '".concat(key, " (").concat(this.language, ")' returned an object instead of string.");
            if (returnDetails) {
              resolved.res = r;
              return resolved;
            }
            return r;
          }
          if (keySeparator) {
            var resTypeIsArray = resType === "[object Array]";
            var copy2 = resTypeIsArray ? [] : {};
            var newKeyToUse = resTypeIsArray ? resExactUsedKey : resUsedKey;
            for (var m in res) {
              if (Object.prototype.hasOwnProperty.call(res, m)) {
                var deepKey = "".concat(newKeyToUse).concat(keySeparator).concat(m);
                copy2[m] = this.translate(deepKey, _objectSpread$4(_objectSpread$4({}, options), {
                  joinArrays: false,
                  ns: namespaces
                }));
                if (copy2[m] === deepKey)
                  copy2[m] = res[m];
              }
            }
            res = copy2;
          }
        } else if (handleAsObjectInI18nFormat && typeof joinArrays === "string" && resType === "[object Array]") {
          res = res.join(joinArrays);
          if (res)
            res = this.extendTranslation(res, keys, options, lastKey);
        } else {
          var usedDefault = false;
          var usedKey = false;
          var needsPluralHandling = options.count !== void 0 && typeof options.count !== "string";
          var hasDefaultValue = Translator2.hasDefaultValue(options);
          var defaultValueSuffix = needsPluralHandling ? this.pluralResolver.getSuffix(lng, options.count, options) : "";
          var defaultValue = options["defaultValue".concat(defaultValueSuffix)] || options.defaultValue;
          if (!this.isValidLookup(res) && hasDefaultValue) {
            usedDefault = true;
            res = defaultValue;
          }
          if (!this.isValidLookup(res)) {
            usedKey = true;
            res = key;
          }
          var missingKeyNoValueFallbackToKey = options.missingKeyNoValueFallbackToKey || this.options.missingKeyNoValueFallbackToKey;
          var resForMissing = missingKeyNoValueFallbackToKey && usedKey ? void 0 : res;
          var updateMissing = hasDefaultValue && defaultValue !== res && this.options.updateMissing;
          if (usedKey || usedDefault || updateMissing) {
            this.logger.log(updateMissing ? "updateKey" : "missingKey", lng, namespace, key, updateMissing ? defaultValue : res);
            if (keySeparator) {
              var fk = this.resolve(key, _objectSpread$4(_objectSpread$4({}, options), {}, {
                keySeparator: false
              }));
              if (fk && fk.res)
                this.logger.warn("Seems the loaded translations were in flat JSON format instead of nested. Either set keySeparator: false on init or make sure your translations are published in nested format.");
            }
            var lngs = [];
            var fallbackLngs = this.languageUtils.getFallbackCodes(this.options.fallbackLng, options.lng || this.language);
            if (this.options.saveMissingTo === "fallback" && fallbackLngs && fallbackLngs[0]) {
              for (var i = 0; i < fallbackLngs.length; i++) {
                lngs.push(fallbackLngs[i]);
              }
            } else if (this.options.saveMissingTo === "all") {
              lngs = this.languageUtils.toResolveHierarchy(options.lng || this.language);
            } else {
              lngs.push(options.lng || this.language);
            }
            var send = function send2(l, k, specificDefaultValue) {
              var defaultForMissing = hasDefaultValue && specificDefaultValue !== res ? specificDefaultValue : resForMissing;
              if (_this2.options.missingKeyHandler) {
                _this2.options.missingKeyHandler(l, namespace, k, defaultForMissing, updateMissing, options);
              } else if (_this2.backendConnector && _this2.backendConnector.saveMissing) {
                _this2.backendConnector.saveMissing(l, namespace, k, defaultForMissing, updateMissing, options);
              }
              _this2.emit("missingKey", l, namespace, k, res);
            };
            if (this.options.saveMissing) {
              if (this.options.saveMissingPlurals && needsPluralHandling) {
                lngs.forEach(function(language) {
                  _this2.pluralResolver.getSuffixes(language, options).forEach(function(suffix) {
                    send([language], key + suffix, options["defaultValue".concat(suffix)] || defaultValue);
                  });
                });
              } else {
                send(lngs, key, defaultValue);
              }
            }
          }
          res = this.extendTranslation(res, keys, options, resolved, lastKey);
          if (usedKey && res === key && this.options.appendNamespaceToMissingKey)
            res = "".concat(namespace, ":").concat(key);
          if ((usedKey || usedDefault) && this.options.parseMissingKeyHandler) {
            if (this.options.compatibilityAPI !== "v1") {
              res = this.options.parseMissingKeyHandler(this.options.appendNamespaceToMissingKey ? "".concat(namespace, ":").concat(key) : key, usedDefault ? res : void 0);
            } else {
              res = this.options.parseMissingKeyHandler(res);
            }
          }
        }
        if (returnDetails) {
          resolved.res = res;
          return resolved;
        }
        return res;
      }
    }, {
      key: "extendTranslation",
      value: function extendTranslation(res, key, options, resolved, lastKey) {
        var _this3 = this;
        if (this.i18nFormat && this.i18nFormat.parse) {
          res = this.i18nFormat.parse(res, _objectSpread$4(_objectSpread$4({}, this.options.interpolation.defaultVariables), options), resolved.usedLng, resolved.usedNS, resolved.usedKey, {
            resolved
          });
        } else if (!options.skipInterpolation) {
          if (options.interpolation)
            this.interpolator.init(_objectSpread$4(_objectSpread$4({}, options), {
              interpolation: _objectSpread$4(_objectSpread$4({}, this.options.interpolation), options.interpolation)
            }));
          var skipOnVariables = typeof res === "string" && (options && options.interpolation && options.interpolation.skipOnVariables !== void 0 ? options.interpolation.skipOnVariables : this.options.interpolation.skipOnVariables);
          var nestBef;
          if (skipOnVariables) {
            var nb = res.match(this.interpolator.nestingRegexp);
            nestBef = nb && nb.length;
          }
          var data = options.replace && typeof options.replace !== "string" ? options.replace : options;
          if (this.options.interpolation.defaultVariables)
            data = _objectSpread$4(_objectSpread$4({}, this.options.interpolation.defaultVariables), data);
          res = this.interpolator.interpolate(res, data, options.lng || this.language, options);
          if (skipOnVariables) {
            var na = res.match(this.interpolator.nestingRegexp);
            var nestAft = na && na.length;
            if (nestBef < nestAft)
              options.nest = false;
          }
          if (options.nest !== false)
            res = this.interpolator.nest(res, function() {
              for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
                args[_key] = arguments[_key];
              }
              if (lastKey && lastKey[0] === args[0] && !options.context) {
                _this3.logger.warn("It seems you are nesting recursively key: ".concat(args[0], " in key: ").concat(key[0]));
                return null;
              }
              return _this3.translate.apply(_this3, args.concat([key]));
            }, options);
          if (options.interpolation)
            this.interpolator.reset();
        }
        var postProcess = options.postProcess || this.options.postProcess;
        var postProcessorNames = typeof postProcess === "string" ? [postProcess] : postProcess;
        if (res !== void 0 && res !== null && postProcessorNames && postProcessorNames.length && options.applyPostProcessor !== false) {
          res = postProcessor.handle(postProcessorNames, res, key, this.options && this.options.postProcessPassResolved ? _objectSpread$4({
            i18nResolved: resolved
          }, options) : options, this);
        }
        return res;
      }
    }, {
      key: "resolve",
      value: function resolve(keys) {
        var _this4 = this;
        var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
        var found;
        var usedKey;
        var exactUsedKey;
        var usedLng;
        var usedNS;
        if (typeof keys === "string")
          keys = [keys];
        keys.forEach(function(k) {
          if (_this4.isValidLookup(found))
            return;
          var extracted = _this4.extractFromKey(k, options);
          var key = extracted.key;
          usedKey = key;
          var namespaces = extracted.namespaces;
          if (_this4.options.fallbackNS)
            namespaces = namespaces.concat(_this4.options.fallbackNS);
          var needsPluralHandling = options.count !== void 0 && typeof options.count !== "string";
          var needsZeroSuffixLookup = needsPluralHandling && !options.ordinal && options.count === 0 && _this4.pluralResolver.shouldUseIntlApi();
          var needsContextHandling = options.context !== void 0 && (typeof options.context === "string" || typeof options.context === "number") && options.context !== "";
          var codes = options.lngs ? options.lngs : _this4.languageUtils.toResolveHierarchy(options.lng || _this4.language, options.fallbackLng);
          namespaces.forEach(function(ns) {
            if (_this4.isValidLookup(found))
              return;
            usedNS = ns;
            if (!checkedLoadedFor["".concat(codes[0], "-").concat(ns)] && _this4.utils && _this4.utils.hasLoadedNamespace && !_this4.utils.hasLoadedNamespace(usedNS)) {
              checkedLoadedFor["".concat(codes[0], "-").concat(ns)] = true;
              _this4.logger.warn('key "'.concat(usedKey, '" for languages "').concat(codes.join(", "), `" won't get resolved as namespace "`).concat(usedNS, '" was not yet loaded'), "This means something IS WRONG in your setup. You access the t function before i18next.init / i18next.loadNamespace / i18next.changeLanguage was done. Wait for the callback or Promise to resolve before accessing it!!!");
            }
            codes.forEach(function(code) {
              if (_this4.isValidLookup(found))
                return;
              usedLng = code;
              var finalKeys = [key];
              if (_this4.i18nFormat && _this4.i18nFormat.addLookupKeys) {
                _this4.i18nFormat.addLookupKeys(finalKeys, key, code, ns, options);
              } else {
                var pluralSuffix;
                if (needsPluralHandling)
                  pluralSuffix = _this4.pluralResolver.getSuffix(code, options.count, options);
                var zeroSuffix = "".concat(_this4.options.pluralSeparator, "zero");
                if (needsPluralHandling) {
                  finalKeys.push(key + pluralSuffix);
                  if (needsZeroSuffixLookup) {
                    finalKeys.push(key + zeroSuffix);
                  }
                }
                if (needsContextHandling) {
                  var contextKey = "".concat(key).concat(_this4.options.contextSeparator).concat(options.context);
                  finalKeys.push(contextKey);
                  if (needsPluralHandling) {
                    finalKeys.push(contextKey + pluralSuffix);
                    if (needsZeroSuffixLookup) {
                      finalKeys.push(contextKey + zeroSuffix);
                    }
                  }
                }
              }
              var possibleKey;
              while (possibleKey = finalKeys.pop()) {
                if (!_this4.isValidLookup(found)) {
                  exactUsedKey = possibleKey;
                  found = _this4.getResource(code, ns, possibleKey, options);
                }
              }
            });
          });
        });
        return {
          res: found,
          usedKey,
          exactUsedKey,
          usedLng,
          usedNS
        };
      }
    }, {
      key: "isValidLookup",
      value: function isValidLookup(res) {
        return res !== void 0 && !(!this.options.returnNull && res === null) && !(!this.options.returnEmptyString && res === "");
      }
    }, {
      key: "getResource",
      value: function getResource(code, ns, key) {
        var options = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {};
        if (this.i18nFormat && this.i18nFormat.getResource)
          return this.i18nFormat.getResource(code, ns, key, options);
        return this.resourceStore.getResource(code, ns, key, options);
      }
    }], [{
      key: "hasDefaultValue",
      value: function hasDefaultValue(options) {
        var prefix = "defaultValue";
        for (var option in options) {
          if (Object.prototype.hasOwnProperty.call(options, option) && prefix === option.substring(0, prefix.length) && void 0 !== options[option]) {
            return true;
          }
        }
        return false;
      }
    }]);
    return Translator2;
  }(EventEmitter);
  function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
  }
  var LanguageUtil = function() {
    function LanguageUtil2(options) {
      _classCallCheck(this, LanguageUtil2);
      this.options = options;
      this.supportedLngs = this.options.supportedLngs || false;
      this.logger = baseLogger.create("languageUtils");
    }
    _createClass(LanguageUtil2, [{
      key: "getScriptPartFromCode",
      value: function getScriptPartFromCode(code) {
        if (!code || code.indexOf("-") < 0)
          return null;
        var p = code.split("-");
        if (p.length === 2)
          return null;
        p.pop();
        if (p[p.length - 1].toLowerCase() === "x")
          return null;
        return this.formatLanguageCode(p.join("-"));
      }
    }, {
      key: "getLanguagePartFromCode",
      value: function getLanguagePartFromCode(code) {
        if (!code || code.indexOf("-") < 0)
          return code;
        var p = code.split("-");
        return this.formatLanguageCode(p[0]);
      }
    }, {
      key: "formatLanguageCode",
      value: function formatLanguageCode(code) {
        if (typeof code === "string" && code.indexOf("-") > -1) {
          var specialCases = ["hans", "hant", "latn", "cyrl", "cans", "mong", "arab"];
          var p = code.split("-");
          if (this.options.lowerCaseLng) {
            p = p.map(function(part) {
              return part.toLowerCase();
            });
          } else if (p.length === 2) {
            p[0] = p[0].toLowerCase();
            p[1] = p[1].toUpperCase();
            if (specialCases.indexOf(p[1].toLowerCase()) > -1)
              p[1] = capitalize(p[1].toLowerCase());
          } else if (p.length === 3) {
            p[0] = p[0].toLowerCase();
            if (p[1].length === 2)
              p[1] = p[1].toUpperCase();
            if (p[0] !== "sgn" && p[2].length === 2)
              p[2] = p[2].toUpperCase();
            if (specialCases.indexOf(p[1].toLowerCase()) > -1)
              p[1] = capitalize(p[1].toLowerCase());
            if (specialCases.indexOf(p[2].toLowerCase()) > -1)
              p[2] = capitalize(p[2].toLowerCase());
          }
          return p.join("-");
        }
        return this.options.cleanCode || this.options.lowerCaseLng ? code.toLowerCase() : code;
      }
    }, {
      key: "isSupportedCode",
      value: function isSupportedCode(code) {
        if (this.options.load === "languageOnly" || this.options.nonExplicitSupportedLngs) {
          code = this.getLanguagePartFromCode(code);
        }
        return !this.supportedLngs || !this.supportedLngs.length || this.supportedLngs.indexOf(code) > -1;
      }
    }, {
      key: "getBestMatchFromCodes",
      value: function getBestMatchFromCodes(codes) {
        var _this = this;
        if (!codes)
          return null;
        var found;
        codes.forEach(function(code) {
          if (found)
            return;
          var cleanedLng = _this.formatLanguageCode(code);
          if (!_this.options.supportedLngs || _this.isSupportedCode(cleanedLng))
            found = cleanedLng;
        });
        if (!found && this.options.supportedLngs) {
          codes.forEach(function(code) {
            if (found)
              return;
            var lngOnly = _this.getLanguagePartFromCode(code);
            if (_this.isSupportedCode(lngOnly))
              return found = lngOnly;
            found = _this.options.supportedLngs.find(function(supportedLng) {
              if (supportedLng.indexOf(lngOnly) === 0)
                return supportedLng;
            });
          });
        }
        if (!found)
          found = this.getFallbackCodes(this.options.fallbackLng)[0];
        return found;
      }
    }, {
      key: "getFallbackCodes",
      value: function getFallbackCodes(fallbacks, code) {
        if (!fallbacks)
          return [];
        if (typeof fallbacks === "function")
          fallbacks = fallbacks(code);
        if (typeof fallbacks === "string")
          fallbacks = [fallbacks];
        if (Object.prototype.toString.apply(fallbacks) === "[object Array]")
          return fallbacks;
        if (!code)
          return fallbacks["default"] || [];
        var found = fallbacks[code];
        if (!found)
          found = fallbacks[this.getScriptPartFromCode(code)];
        if (!found)
          found = fallbacks[this.formatLanguageCode(code)];
        if (!found)
          found = fallbacks[this.getLanguagePartFromCode(code)];
        if (!found)
          found = fallbacks["default"];
        return found || [];
      }
    }, {
      key: "toResolveHierarchy",
      value: function toResolveHierarchy(code, fallbackCode) {
        var _this2 = this;
        var fallbackCodes = this.getFallbackCodes(fallbackCode || this.options.fallbackLng || [], code);
        var codes = [];
        var addCode = function addCode2(c) {
          if (!c)
            return;
          if (_this2.isSupportedCode(c)) {
            codes.push(c);
          } else {
            _this2.logger.warn("rejecting language code not found in supportedLngs: ".concat(c));
          }
        };
        if (typeof code === "string" && code.indexOf("-") > -1) {
          if (this.options.load !== "languageOnly")
            addCode(this.formatLanguageCode(code));
          if (this.options.load !== "languageOnly" && this.options.load !== "currentOnly")
            addCode(this.getScriptPartFromCode(code));
          if (this.options.load !== "currentOnly")
            addCode(this.getLanguagePartFromCode(code));
        } else if (typeof code === "string") {
          addCode(this.formatLanguageCode(code));
        }
        fallbackCodes.forEach(function(fc) {
          if (codes.indexOf(fc) < 0)
            addCode(_this2.formatLanguageCode(fc));
        });
        return codes;
      }
    }]);
    return LanguageUtil2;
  }();
  var sets = [{
    lngs: ["ach", "ak", "am", "arn", "br", "fil", "gun", "ln", "mfe", "mg", "mi", "oc", "pt", "pt-BR", "tg", "tl", "ti", "tr", "uz", "wa"],
    nr: [1, 2],
    fc: 1
  }, {
    lngs: ["af", "an", "ast", "az", "bg", "bn", "ca", "da", "de", "dev", "el", "en", "eo", "es", "et", "eu", "fi", "fo", "fur", "fy", "gl", "gu", "ha", "hi", "hu", "hy", "ia", "it", "kk", "kn", "ku", "lb", "mai", "ml", "mn", "mr", "nah", "nap", "nb", "ne", "nl", "nn", "no", "nso", "pa", "pap", "pms", "ps", "pt-PT", "rm", "sco", "se", "si", "so", "son", "sq", "sv", "sw", "ta", "te", "tk", "ur", "yo"],
    nr: [1, 2],
    fc: 2
  }, {
    lngs: ["ay", "bo", "cgg", "fa", "ht", "id", "ja", "jbo", "ka", "km", "ko", "ky", "lo", "ms", "sah", "su", "th", "tt", "ug", "vi", "wo", "zh"],
    nr: [1],
    fc: 3
  }, {
    lngs: ["be", "bs", "cnr", "dz", "hr", "ru", "sr", "uk"],
    nr: [1, 2, 5],
    fc: 4
  }, {
    lngs: ["ar"],
    nr: [0, 1, 2, 3, 11, 100],
    fc: 5
  }, {
    lngs: ["cs", "sk"],
    nr: [1, 2, 5],
    fc: 6
  }, {
    lngs: ["csb", "pl"],
    nr: [1, 2, 5],
    fc: 7
  }, {
    lngs: ["cy"],
    nr: [1, 2, 3, 8],
    fc: 8
  }, {
    lngs: ["fr"],
    nr: [1, 2],
    fc: 9
  }, {
    lngs: ["ga"],
    nr: [1, 2, 3, 7, 11],
    fc: 10
  }, {
    lngs: ["gd"],
    nr: [1, 2, 3, 20],
    fc: 11
  }, {
    lngs: ["is"],
    nr: [1, 2],
    fc: 12
  }, {
    lngs: ["jv"],
    nr: [0, 1],
    fc: 13
  }, {
    lngs: ["kw"],
    nr: [1, 2, 3, 4],
    fc: 14
  }, {
    lngs: ["lt"],
    nr: [1, 2, 10],
    fc: 15
  }, {
    lngs: ["lv"],
    nr: [1, 2, 0],
    fc: 16
  }, {
    lngs: ["mk"],
    nr: [1, 2],
    fc: 17
  }, {
    lngs: ["mnk"],
    nr: [0, 1, 2],
    fc: 18
  }, {
    lngs: ["mt"],
    nr: [1, 2, 11, 20],
    fc: 19
  }, {
    lngs: ["or"],
    nr: [2, 1],
    fc: 2
  }, {
    lngs: ["ro"],
    nr: [1, 2, 20],
    fc: 20
  }, {
    lngs: ["sl"],
    nr: [5, 1, 2, 3],
    fc: 21
  }, {
    lngs: ["he", "iw"],
    nr: [1, 2, 20, 21],
    fc: 22
  }];
  var _rulesPluralsTypes = {
    1: function _(n) {
      return Number(n > 1);
    },
    2: function _2(n) {
      return Number(n != 1);
    },
    3: function _3(n) {
      return 0;
    },
    4: function _4(n) {
      return Number(n % 10 == 1 && n % 100 != 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2);
    },
    5: function _5(n) {
      return Number(n == 0 ? 0 : n == 1 ? 1 : n == 2 ? 2 : n % 100 >= 3 && n % 100 <= 10 ? 3 : n % 100 >= 11 ? 4 : 5);
    },
    6: function _6(n) {
      return Number(n == 1 ? 0 : n >= 2 && n <= 4 ? 1 : 2);
    },
    7: function _7(n) {
      return Number(n == 1 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2);
    },
    8: function _8(n) {
      return Number(n == 1 ? 0 : n == 2 ? 1 : n != 8 && n != 11 ? 2 : 3);
    },
    9: function _9(n) {
      return Number(n >= 2);
    },
    10: function _10(n) {
      return Number(n == 1 ? 0 : n == 2 ? 1 : n < 7 ? 2 : n < 11 ? 3 : 4);
    },
    11: function _11(n) {
      return Number(n == 1 || n == 11 ? 0 : n == 2 || n == 12 ? 1 : n > 2 && n < 20 ? 2 : 3);
    },
    12: function _12(n) {
      return Number(n % 10 != 1 || n % 100 == 11);
    },
    13: function _13(n) {
      return Number(n !== 0);
    },
    14: function _14(n) {
      return Number(n == 1 ? 0 : n == 2 ? 1 : n == 3 ? 2 : 3);
    },
    15: function _15(n) {
      return Number(n % 10 == 1 && n % 100 != 11 ? 0 : n % 10 >= 2 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2);
    },
    16: function _16(n) {
      return Number(n % 10 == 1 && n % 100 != 11 ? 0 : n !== 0 ? 1 : 2);
    },
    17: function _17(n) {
      return Number(n == 1 || n % 10 == 1 && n % 100 != 11 ? 0 : 1);
    },
    18: function _18(n) {
      return Number(n == 0 ? 0 : n == 1 ? 1 : 2);
    },
    19: function _19(n) {
      return Number(n == 1 ? 0 : n == 0 || n % 100 > 1 && n % 100 < 11 ? 1 : n % 100 > 10 && n % 100 < 20 ? 2 : 3);
    },
    20: function _20(n) {
      return Number(n == 1 ? 0 : n == 0 || n % 100 > 0 && n % 100 < 20 ? 1 : 2);
    },
    21: function _21(n) {
      return Number(n % 100 == 1 ? 1 : n % 100 == 2 ? 2 : n % 100 == 3 || n % 100 == 4 ? 3 : 0);
    },
    22: function _22(n) {
      return Number(n == 1 ? 0 : n == 2 ? 1 : (n < 0 || n > 10) && n % 10 == 0 ? 2 : 3);
    }
  };
  var deprecatedJsonVersions = ["v1", "v2", "v3"];
  var suffixesOrder = {
    zero: 0,
    one: 1,
    two: 2,
    few: 3,
    many: 4,
    other: 5
  };
  function createRules() {
    var rules = {};
    sets.forEach(function(set) {
      set.lngs.forEach(function(l) {
        rules[l] = {
          numbers: set.nr,
          plurals: _rulesPluralsTypes[set.fc]
        };
      });
    });
    return rules;
  }
  var PluralResolver = function() {
    function PluralResolver2(languageUtils) {
      var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
      _classCallCheck(this, PluralResolver2);
      this.languageUtils = languageUtils;
      this.options = options;
      this.logger = baseLogger.create("pluralResolver");
      if ((!this.options.compatibilityJSON || this.options.compatibilityJSON === "v4") && (typeof Intl === "undefined" || !Intl.PluralRules)) {
        this.options.compatibilityJSON = "v3";
        this.logger.error("Your environment seems not to be Intl API compatible, use an Intl.PluralRules polyfill. Will fallback to the compatibilityJSON v3 format handling.");
      }
      this.rules = createRules();
    }
    _createClass(PluralResolver2, [{
      key: "addRule",
      value: function addRule(lng, obj) {
        this.rules[lng] = obj;
      }
    }, {
      key: "getRule",
      value: function getRule(code) {
        var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
        if (this.shouldUseIntlApi()) {
          try {
            return new Intl.PluralRules(code, {
              type: options.ordinal ? "ordinal" : "cardinal"
            });
          } catch (_unused) {
            return;
          }
        }
        return this.rules[code] || this.rules[this.languageUtils.getLanguagePartFromCode(code)];
      }
    }, {
      key: "needsPlural",
      value: function needsPlural(code) {
        var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
        var rule = this.getRule(code, options);
        if (this.shouldUseIntlApi()) {
          return rule && rule.resolvedOptions().pluralCategories.length > 1;
        }
        return rule && rule.numbers.length > 1;
      }
    }, {
      key: "getPluralFormsOfKey",
      value: function getPluralFormsOfKey(code, key) {
        var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
        return this.getSuffixes(code, options).map(function(suffix) {
          return "".concat(key).concat(suffix);
        });
      }
    }, {
      key: "getSuffixes",
      value: function getSuffixes(code) {
        var _this = this;
        var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
        var rule = this.getRule(code, options);
        if (!rule) {
          return [];
        }
        if (this.shouldUseIntlApi()) {
          return rule.resolvedOptions().pluralCategories.sort(function(pluralCategory1, pluralCategory2) {
            return suffixesOrder[pluralCategory1] - suffixesOrder[pluralCategory2];
          }).map(function(pluralCategory) {
            return "".concat(_this.options.prepend).concat(pluralCategory);
          });
        }
        return rule.numbers.map(function(number) {
          return _this.getSuffix(code, number, options);
        });
      }
    }, {
      key: "getSuffix",
      value: function getSuffix(code, count) {
        var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
        var rule = this.getRule(code, options);
        if (rule) {
          if (this.shouldUseIntlApi()) {
            return "".concat(this.options.prepend).concat(rule.select(count));
          }
          return this.getSuffixRetroCompatible(rule, count);
        }
        this.logger.warn("no plural rule found for: ".concat(code));
        return "";
      }
    }, {
      key: "getSuffixRetroCompatible",
      value: function getSuffixRetroCompatible(rule, count) {
        var _this2 = this;
        var idx = rule.noAbs ? rule.plurals(count) : rule.plurals(Math.abs(count));
        var suffix = rule.numbers[idx];
        if (this.options.simplifyPluralSuffix && rule.numbers.length === 2 && rule.numbers[0] === 1) {
          if (suffix === 2) {
            suffix = "plural";
          } else if (suffix === 1) {
            suffix = "";
          }
        }
        var returnSuffix = function returnSuffix2() {
          return _this2.options.prepend && suffix.toString() ? _this2.options.prepend + suffix.toString() : suffix.toString();
        };
        if (this.options.compatibilityJSON === "v1") {
          if (suffix === 1)
            return "";
          if (typeof suffix === "number")
            return "_plural_".concat(suffix.toString());
          return returnSuffix();
        } else if (this.options.compatibilityJSON === "v2") {
          return returnSuffix();
        } else if (this.options.simplifyPluralSuffix && rule.numbers.length === 2 && rule.numbers[0] === 1) {
          return returnSuffix();
        }
        return this.options.prepend && idx.toString() ? this.options.prepend + idx.toString() : idx.toString();
      }
    }, {
      key: "shouldUseIntlApi",
      value: function shouldUseIntlApi() {
        return !deprecatedJsonVersions.includes(this.options.compatibilityJSON);
      }
    }]);
    return PluralResolver2;
  }();
  function ownKeys$3(object2, enumerableOnly) {
    var keys = Object.keys(object2);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object2);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object2, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread$3(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2 ? ownKeys$3(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys$3(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  var Interpolator = function() {
    function Interpolator2() {
      var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      _classCallCheck(this, Interpolator2);
      this.logger = baseLogger.create("interpolator");
      this.options = options;
      this.format = options.interpolation && options.interpolation.format || function(value) {
        return value;
      };
      this.init(options);
    }
    _createClass(Interpolator2, [{
      key: "init",
      value: function init2() {
        var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
        if (!options.interpolation)
          options.interpolation = {
            escapeValue: true
          };
        var iOpts = options.interpolation;
        this.escape = iOpts.escape !== void 0 ? iOpts.escape : escape;
        this.escapeValue = iOpts.escapeValue !== void 0 ? iOpts.escapeValue : true;
        this.useRawValueToEscape = iOpts.useRawValueToEscape !== void 0 ? iOpts.useRawValueToEscape : false;
        this.prefix = iOpts.prefix ? regexEscape(iOpts.prefix) : iOpts.prefixEscaped || "{{";
        this.suffix = iOpts.suffix ? regexEscape(iOpts.suffix) : iOpts.suffixEscaped || "}}";
        this.formatSeparator = iOpts.formatSeparator ? iOpts.formatSeparator : iOpts.formatSeparator || ",";
        this.unescapePrefix = iOpts.unescapeSuffix ? "" : iOpts.unescapePrefix || "-";
        this.unescapeSuffix = this.unescapePrefix ? "" : iOpts.unescapeSuffix || "";
        this.nestingPrefix = iOpts.nestingPrefix ? regexEscape(iOpts.nestingPrefix) : iOpts.nestingPrefixEscaped || regexEscape("$t(");
        this.nestingSuffix = iOpts.nestingSuffix ? regexEscape(iOpts.nestingSuffix) : iOpts.nestingSuffixEscaped || regexEscape(")");
        this.nestingOptionsSeparator = iOpts.nestingOptionsSeparator ? iOpts.nestingOptionsSeparator : iOpts.nestingOptionsSeparator || ",";
        this.maxReplaces = iOpts.maxReplaces ? iOpts.maxReplaces : 1e3;
        this.alwaysFormat = iOpts.alwaysFormat !== void 0 ? iOpts.alwaysFormat : false;
        this.resetRegExp();
      }
    }, {
      key: "reset",
      value: function reset() {
        if (this.options)
          this.init(this.options);
      }
    }, {
      key: "resetRegExp",
      value: function resetRegExp() {
        var regexpStr = "".concat(this.prefix, "(.+?)").concat(this.suffix);
        this.regexp = new RegExp(regexpStr, "g");
        var regexpUnescapeStr = "".concat(this.prefix).concat(this.unescapePrefix, "(.+?)").concat(this.unescapeSuffix).concat(this.suffix);
        this.regexpUnescape = new RegExp(regexpUnescapeStr, "g");
        var nestingRegexpStr = "".concat(this.nestingPrefix, "(.+?)").concat(this.nestingSuffix);
        this.nestingRegexp = new RegExp(nestingRegexpStr, "g");
      }
    }, {
      key: "interpolate",
      value: function interpolate(str, data, lng, options) {
        var _this = this;
        var match;
        var value;
        var replaces;
        var defaultData = this.options && this.options.interpolation && this.options.interpolation.defaultVariables || {};
        function regexSafe(val) {
          return val.replace(/\$/g, "$$$$");
        }
        var handleFormat = function handleFormat2(key) {
          if (key.indexOf(_this.formatSeparator) < 0) {
            var path = getPathWithDefaults(data, defaultData, key);
            return _this.alwaysFormat ? _this.format(path, void 0, lng, _objectSpread$3(_objectSpread$3(_objectSpread$3({}, options), data), {}, {
              interpolationkey: key
            })) : path;
          }
          var p = key.split(_this.formatSeparator);
          var k = p.shift().trim();
          var f = p.join(_this.formatSeparator).trim();
          return _this.format(getPathWithDefaults(data, defaultData, k), f, lng, _objectSpread$3(_objectSpread$3(_objectSpread$3({}, options), data), {}, {
            interpolationkey: k
          }));
        };
        this.resetRegExp();
        var missingInterpolationHandler = options && options.missingInterpolationHandler || this.options.missingInterpolationHandler;
        var skipOnVariables = options && options.interpolation && options.interpolation.skipOnVariables !== void 0 ? options.interpolation.skipOnVariables : this.options.interpolation.skipOnVariables;
        var todos = [{
          regex: this.regexpUnescape,
          safeValue: function safeValue(val) {
            return regexSafe(val);
          }
        }, {
          regex: this.regexp,
          safeValue: function safeValue(val) {
            return _this.escapeValue ? regexSafe(_this.escape(val)) : regexSafe(val);
          }
        }];
        todos.forEach(function(todo) {
          replaces = 0;
          while (match = todo.regex.exec(str)) {
            var matchedVar = match[1].trim();
            value = handleFormat(matchedVar);
            if (value === void 0) {
              if (typeof missingInterpolationHandler === "function") {
                var temp = missingInterpolationHandler(str, match, options);
                value = typeof temp === "string" ? temp : "";
              } else if (options && Object.prototype.hasOwnProperty.call(options, matchedVar)) {
                value = "";
              } else if (skipOnVariables) {
                value = match[0];
                continue;
              } else {
                _this.logger.warn("missed to pass in variable ".concat(matchedVar, " for interpolating ").concat(str));
                value = "";
              }
            } else if (typeof value !== "string" && !_this.useRawValueToEscape) {
              value = makeString(value);
            }
            var safeValue = todo.safeValue(value);
            str = str.replace(match[0], safeValue);
            if (skipOnVariables) {
              todo.regex.lastIndex += value.length;
              todo.regex.lastIndex -= match[0].length;
            } else {
              todo.regex.lastIndex = 0;
            }
            replaces++;
            if (replaces >= _this.maxReplaces) {
              break;
            }
          }
        });
        return str;
      }
    }, {
      key: "nest",
      value: function nest(str, fc) {
        var _this2 = this;
        var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
        var match;
        var value;
        var clonedOptions;
        function handleHasOptions(key, inheritedOptions) {
          var sep = this.nestingOptionsSeparator;
          if (key.indexOf(sep) < 0)
            return key;
          var c = key.split(new RegExp("".concat(sep, "[ ]*{")));
          var optionsString = "{".concat(c[1]);
          key = c[0];
          optionsString = this.interpolate(optionsString, clonedOptions);
          var matchedSingleQuotes = optionsString.match(/'/g);
          var matchedDoubleQuotes = optionsString.match(/"/g);
          if (matchedSingleQuotes && matchedSingleQuotes.length % 2 === 0 && !matchedDoubleQuotes || matchedDoubleQuotes.length % 2 !== 0) {
            optionsString = optionsString.replace(/'/g, '"');
          }
          try {
            clonedOptions = JSON.parse(optionsString);
            if (inheritedOptions)
              clonedOptions = _objectSpread$3(_objectSpread$3({}, inheritedOptions), clonedOptions);
          } catch (e) {
            this.logger.warn("failed parsing options string in nesting for key ".concat(key), e);
            return "".concat(key).concat(sep).concat(optionsString);
          }
          delete clonedOptions.defaultValue;
          return key;
        }
        while (match = this.nestingRegexp.exec(str)) {
          var formatters = [];
          clonedOptions = _objectSpread$3({}, options);
          clonedOptions = clonedOptions.replace && typeof clonedOptions.replace !== "string" ? clonedOptions.replace : clonedOptions;
          clonedOptions.applyPostProcessor = false;
          delete clonedOptions.defaultValue;
          var doReduce = false;
          if (match[0].indexOf(this.formatSeparator) !== -1 && !/{.*}/.test(match[1])) {
            var r = match[1].split(this.formatSeparator).map(function(elem) {
              return elem.trim();
            });
            match[1] = r.shift();
            formatters = r;
            doReduce = true;
          }
          value = fc(handleHasOptions.call(this, match[1].trim(), clonedOptions), clonedOptions);
          if (value && match[0] === str && typeof value !== "string")
            return value;
          if (typeof value !== "string")
            value = makeString(value);
          if (!value) {
            this.logger.warn("missed to resolve ".concat(match[1], " for nesting ").concat(str));
            value = "";
          }
          if (doReduce) {
            value = formatters.reduce(function(v, f) {
              return _this2.format(v, f, options.lng, _objectSpread$3(_objectSpread$3({}, options), {}, {
                interpolationkey: match[1].trim()
              }));
            }, value.trim());
          }
          str = str.replace(match[0], value);
          this.regexp.lastIndex = 0;
        }
        return str;
      }
    }]);
    return Interpolator2;
  }();
  function ownKeys$2(object2, enumerableOnly) {
    var keys = Object.keys(object2);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object2);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object2, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread$2(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2 ? ownKeys$2(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys$2(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  function parseFormatStr(formatStr) {
    var formatName = formatStr.toLowerCase().trim();
    var formatOptions = {};
    if (formatStr.indexOf("(") > -1) {
      var p = formatStr.split("(");
      formatName = p[0].toLowerCase().trim();
      var optStr = p[1].substring(0, p[1].length - 1);
      if (formatName === "currency" && optStr.indexOf(":") < 0) {
        if (!formatOptions.currency)
          formatOptions.currency = optStr.trim();
      } else if (formatName === "relativetime" && optStr.indexOf(":") < 0) {
        if (!formatOptions.range)
          formatOptions.range = optStr.trim();
      } else {
        var opts = optStr.split(";");
        opts.forEach(function(opt) {
          if (!opt)
            return;
          var _opt$split = opt.split(":"), _opt$split2 = _toArray(_opt$split), key = _opt$split2[0], rest = _opt$split2.slice(1);
          var val = rest.join(":").trim().replace(/^'+|'+$/g, "");
          if (!formatOptions[key.trim()])
            formatOptions[key.trim()] = val;
          if (val === "false")
            formatOptions[key.trim()] = false;
          if (val === "true")
            formatOptions[key.trim()] = true;
          if (!isNaN(val))
            formatOptions[key.trim()] = parseInt(val, 10);
        });
      }
    }
    return {
      formatName,
      formatOptions
    };
  }
  function createCachedFormatter(fn) {
    var cache = {};
    return function invokeFormatter(val, lng, options) {
      var key = lng + JSON.stringify(options);
      var formatter = cache[key];
      if (!formatter) {
        formatter = fn(lng, options);
        cache[key] = formatter;
      }
      return formatter(val);
    };
  }
  var Formatter = function() {
    function Formatter2() {
      var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      _classCallCheck(this, Formatter2);
      this.logger = baseLogger.create("formatter");
      this.options = options;
      this.formats = {
        number: createCachedFormatter(function(lng, opt) {
          var formatter = new Intl.NumberFormat(lng, _objectSpread$2({}, opt));
          return function(val) {
            return formatter.format(val);
          };
        }),
        currency: createCachedFormatter(function(lng, opt) {
          var formatter = new Intl.NumberFormat(lng, _objectSpread$2(_objectSpread$2({}, opt), {}, {
            style: "currency"
          }));
          return function(val) {
            return formatter.format(val);
          };
        }),
        datetime: createCachedFormatter(function(lng, opt) {
          var formatter = new Intl.DateTimeFormat(lng, _objectSpread$2({}, opt));
          return function(val) {
            return formatter.format(val);
          };
        }),
        relativetime: createCachedFormatter(function(lng, opt) {
          var formatter = new Intl.RelativeTimeFormat(lng, _objectSpread$2({}, opt));
          return function(val) {
            return formatter.format(val, opt.range || "day");
          };
        }),
        list: createCachedFormatter(function(lng, opt) {
          var formatter = new Intl.ListFormat(lng, _objectSpread$2({}, opt));
          return function(val) {
            return formatter.format(val);
          };
        })
      };
      this.init(options);
    }
    _createClass(Formatter2, [{
      key: "init",
      value: function init2(services) {
        var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {
          interpolation: {}
        };
        var iOpts = options.interpolation;
        this.formatSeparator = iOpts.formatSeparator ? iOpts.formatSeparator : iOpts.formatSeparator || ",";
      }
    }, {
      key: "add",
      value: function add(name, fc) {
        this.formats[name.toLowerCase().trim()] = fc;
      }
    }, {
      key: "addCached",
      value: function addCached(name, fc) {
        this.formats[name.toLowerCase().trim()] = createCachedFormatter(fc);
      }
    }, {
      key: "format",
      value: function format(value, _format, lng) {
        var _this = this;
        var options = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {};
        var formats = _format.split(this.formatSeparator);
        var result3 = formats.reduce(function(mem, f) {
          var _parseFormatStr = parseFormatStr(f), formatName = _parseFormatStr.formatName, formatOptions = _parseFormatStr.formatOptions;
          if (_this.formats[formatName]) {
            var formatted = mem;
            try {
              var valOptions = options && options.formatParams && options.formatParams[options.interpolationkey] || {};
              var l = valOptions.locale || valOptions.lng || options.locale || options.lng || lng;
              formatted = _this.formats[formatName](mem, l, _objectSpread$2(_objectSpread$2(_objectSpread$2({}, formatOptions), options), valOptions));
            } catch (error2) {
              _this.logger.warn(error2);
            }
            return formatted;
          } else {
            _this.logger.warn("there was no format function for ".concat(formatName));
          }
          return mem;
        }, value);
        return result3;
      }
    }]);
    return Formatter2;
  }();
  function ownKeys$1(object2, enumerableOnly) {
    var keys = Object.keys(object2);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object2);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object2, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread$1(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2 ? ownKeys$1(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys$1(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  function _createSuper$1(Derived) {
    var hasNativeReflectConstruct = _isNativeReflectConstruct$1();
    return function _createSuperInternal() {
      var Super = _getPrototypeOf(Derived), result3;
      if (hasNativeReflectConstruct) {
        var NewTarget = _getPrototypeOf(this).constructor;
        result3 = Reflect.construct(Super, arguments, NewTarget);
      } else {
        result3 = Super.apply(this, arguments);
      }
      return _possibleConstructorReturn(this, result3);
    };
  }
  function _isNativeReflectConstruct$1() {
    if (typeof Reflect === "undefined" || !Reflect.construct)
      return false;
    if (Reflect.construct.sham)
      return false;
    if (typeof Proxy === "function")
      return true;
    try {
      Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
      }));
      return true;
    } catch (e) {
      return false;
    }
  }
  function removePending(q, name) {
    if (q.pending[name] !== void 0) {
      delete q.pending[name];
      q.pendingCount--;
    }
  }
  var Connector = function(_EventEmitter) {
    _inherits(Connector2, _EventEmitter);
    var _super = _createSuper$1(Connector2);
    function Connector2(backend, store, services) {
      var _this;
      var options = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : {};
      _classCallCheck(this, Connector2);
      _this = _super.call(this);
      if (isIE10) {
        EventEmitter.call(_assertThisInitialized(_this));
      }
      _this.backend = backend;
      _this.store = store;
      _this.services = services;
      _this.languageUtils = services.languageUtils;
      _this.options = options;
      _this.logger = baseLogger.create("backendConnector");
      _this.waitingReads = [];
      _this.maxParallelReads = options.maxParallelReads || 10;
      _this.readingCalls = 0;
      _this.maxRetries = options.maxRetries >= 0 ? options.maxRetries : 5;
      _this.retryTimeout = options.retryTimeout >= 1 ? options.retryTimeout : 350;
      _this.state = {};
      _this.queue = [];
      if (_this.backend && _this.backend.init) {
        _this.backend.init(services, options.backend, options);
      }
      return _this;
    }
    _createClass(Connector2, [{
      key: "queueLoad",
      value: function queueLoad(languages, namespaces, options, callback) {
        var _this2 = this;
        var toLoad = {};
        var pending = {};
        var toLoadLanguages = {};
        var toLoadNamespaces = {};
        languages.forEach(function(lng) {
          var hasAllNamespaces = true;
          namespaces.forEach(function(ns) {
            var name = "".concat(lng, "|").concat(ns);
            if (!options.reload && _this2.store.hasResourceBundle(lng, ns)) {
              _this2.state[name] = 2;
            } else if (_this2.state[name] < 0)
              ;
            else if (_this2.state[name] === 1) {
              if (pending[name] === void 0)
                pending[name] = true;
            } else {
              _this2.state[name] = 1;
              hasAllNamespaces = false;
              if (pending[name] === void 0)
                pending[name] = true;
              if (toLoad[name] === void 0)
                toLoad[name] = true;
              if (toLoadNamespaces[ns] === void 0)
                toLoadNamespaces[ns] = true;
            }
          });
          if (!hasAllNamespaces)
            toLoadLanguages[lng] = true;
        });
        if (Object.keys(toLoad).length || Object.keys(pending).length) {
          this.queue.push({
            pending,
            pendingCount: Object.keys(pending).length,
            loaded: {},
            errors: [],
            callback
          });
        }
        return {
          toLoad: Object.keys(toLoad),
          pending: Object.keys(pending),
          toLoadLanguages: Object.keys(toLoadLanguages),
          toLoadNamespaces: Object.keys(toLoadNamespaces)
        };
      }
    }, {
      key: "loaded",
      value: function loaded(name, err, data) {
        var s = name.split("|");
        var lng = s[0];
        var ns = s[1];
        if (err)
          this.emit("failedLoading", lng, ns, err);
        if (data) {
          this.store.addResourceBundle(lng, ns, data);
        }
        this.state[name] = err ? -1 : 2;
        var loaded2 = {};
        this.queue.forEach(function(q) {
          pushPath(q.loaded, [lng], ns);
          removePending(q, name);
          if (err)
            q.errors.push(err);
          if (q.pendingCount === 0 && !q.done) {
            Object.keys(q.loaded).forEach(function(l) {
              if (!loaded2[l])
                loaded2[l] = {};
              var loadedKeys = q.loaded[l];
              if (loadedKeys.length) {
                loadedKeys.forEach(function(n) {
                  if (loaded2[l][n] === void 0)
                    loaded2[l][n] = true;
                });
              }
            });
            q.done = true;
            if (q.errors.length) {
              q.callback(q.errors);
            } else {
              q.callback();
            }
          }
        });
        this.emit("loaded", loaded2);
        this.queue = this.queue.filter(function(q) {
          return !q.done;
        });
      }
    }, {
      key: "read",
      value: function read(lng, ns, fcName) {
        var _this3 = this;
        var tried = arguments.length > 3 && arguments[3] !== void 0 ? arguments[3] : 0;
        var wait = arguments.length > 4 && arguments[4] !== void 0 ? arguments[4] : this.retryTimeout;
        var callback = arguments.length > 5 ? arguments[5] : void 0;
        if (!lng.length)
          return callback(null, {});
        if (this.readingCalls >= this.maxParallelReads) {
          this.waitingReads.push({
            lng,
            ns,
            fcName,
            tried,
            wait,
            callback
          });
          return;
        }
        this.readingCalls++;
        var resolver = function resolver2(err, data) {
          _this3.readingCalls--;
          if (_this3.waitingReads.length > 0) {
            var next = _this3.waitingReads.shift();
            _this3.read(next.lng, next.ns, next.fcName, next.tried, next.wait, next.callback);
          }
          if (err && data && tried < _this3.maxRetries) {
            setTimeout(function() {
              _this3.read.call(_this3, lng, ns, fcName, tried + 1, wait * 2, callback);
            }, wait);
            return;
          }
          callback(err, data);
        };
        var fc = this.backend[fcName].bind(this.backend);
        if (fc.length === 2) {
          try {
            var r = fc(lng, ns);
            if (r && typeof r.then === "function") {
              r.then(function(data) {
                return resolver(null, data);
              })["catch"](resolver);
            } else {
              resolver(null, r);
            }
          } catch (err) {
            resolver(err);
          }
          return;
        }
        return fc(lng, ns, resolver);
      }
    }, {
      key: "prepareLoading",
      value: function prepareLoading(languages, namespaces) {
        var _this4 = this;
        var options = arguments.length > 2 && arguments[2] !== void 0 ? arguments[2] : {};
        var callback = arguments.length > 3 ? arguments[3] : void 0;
        if (!this.backend) {
          this.logger.warn("No backend was added via i18next.use. Will not load resources.");
          return callback && callback();
        }
        if (typeof languages === "string")
          languages = this.languageUtils.toResolveHierarchy(languages);
        if (typeof namespaces === "string")
          namespaces = [namespaces];
        var toLoad = this.queueLoad(languages, namespaces, options, callback);
        if (!toLoad.toLoad.length) {
          if (!toLoad.pending.length)
            callback();
          return null;
        }
        toLoad.toLoad.forEach(function(name) {
          _this4.loadOne(name);
        });
      }
    }, {
      key: "load",
      value: function load(languages, namespaces, callback) {
        this.prepareLoading(languages, namespaces, {}, callback);
      }
    }, {
      key: "reload",
      value: function reload(languages, namespaces, callback) {
        this.prepareLoading(languages, namespaces, {
          reload: true
        }, callback);
      }
    }, {
      key: "loadOne",
      value: function loadOne(name) {
        var _this5 = this;
        var prefix = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : "";
        var s = name.split("|");
        var lng = s[0];
        var ns = s[1];
        this.read(lng, ns, "read", void 0, void 0, function(err, data) {
          if (err)
            _this5.logger.warn("".concat(prefix, "loading namespace ").concat(ns, " for language ").concat(lng, " failed"), err);
          if (!err && data)
            _this5.logger.log("".concat(prefix, "loaded namespace ").concat(ns, " for language ").concat(lng), data);
          _this5.loaded(name, err, data);
        });
      }
    }, {
      key: "saveMissing",
      value: function saveMissing(languages, namespace, key, fallbackValue, isUpdate) {
        var options = arguments.length > 5 && arguments[5] !== void 0 ? arguments[5] : {};
        var clb = arguments.length > 6 && arguments[6] !== void 0 ? arguments[6] : function() {
        };
        if (this.services.utils && this.services.utils.hasLoadedNamespace && !this.services.utils.hasLoadedNamespace(namespace)) {
          this.logger.warn('did not save key "'.concat(key, '" as the namespace "').concat(namespace, '" was not yet loaded'), "This means something IS WRONG in your setup. You access the t function before i18next.init / i18next.loadNamespace / i18next.changeLanguage was done. Wait for the callback or Promise to resolve before accessing it!!!");
          return;
        }
        if (key === void 0 || key === null || key === "")
          return;
        if (this.backend && this.backend.create) {
          var opts = _objectSpread$1(_objectSpread$1({}, options), {}, {
            isUpdate
          });
          var fc = this.backend.create.bind(this.backend);
          if (fc.length < 6) {
            try {
              var r;
              if (fc.length === 5) {
                r = fc(languages, namespace, key, fallbackValue, opts);
              } else {
                r = fc(languages, namespace, key, fallbackValue);
              }
              if (r && typeof r.then === "function") {
                r.then(function(data) {
                  return clb(null, data);
                })["catch"](clb);
              } else {
                clb(null, r);
              }
            } catch (err) {
              clb(err);
            }
          } else {
            fc(languages, namespace, key, fallbackValue, clb, opts);
          }
        }
        if (!languages || !languages[0])
          return;
        this.store.addResource(languages[0], namespace, key, fallbackValue);
      }
    }]);
    return Connector2;
  }(EventEmitter);
  function get() {
    return {
      debug: false,
      initImmediate: true,
      ns: ["translation"],
      defaultNS: ["translation"],
      fallbackLng: ["dev"],
      fallbackNS: false,
      supportedLngs: false,
      nonExplicitSupportedLngs: false,
      load: "all",
      preload: false,
      simplifyPluralSuffix: true,
      keySeparator: ".",
      nsSeparator: ":",
      pluralSeparator: "_",
      contextSeparator: "_",
      partialBundledLanguages: false,
      saveMissing: false,
      updateMissing: false,
      saveMissingTo: "fallback",
      saveMissingPlurals: true,
      missingKeyHandler: false,
      missingInterpolationHandler: false,
      postProcess: false,
      postProcessPassResolved: false,
      returnNull: true,
      returnEmptyString: true,
      returnObjects: false,
      joinArrays: false,
      returnedObjectHandler: false,
      parseMissingKeyHandler: false,
      appendNamespaceToMissingKey: false,
      appendNamespaceToCIMode: false,
      overloadTranslationOptionHandler: function handle2(args) {
        var ret = {};
        if (_typeof(args[1]) === "object")
          ret = args[1];
        if (typeof args[1] === "string")
          ret.defaultValue = args[1];
        if (typeof args[2] === "string")
          ret.tDescription = args[2];
        if (_typeof(args[2]) === "object" || _typeof(args[3]) === "object") {
          var options = args[3] || args[2];
          Object.keys(options).forEach(function(key) {
            ret[key] = options[key];
          });
        }
        return ret;
      },
      interpolation: {
        escapeValue: true,
        format: function format(value, _format, lng, options) {
          return value;
        },
        prefix: "{{",
        suffix: "}}",
        formatSeparator: ",",
        unescapePrefix: "-",
        nestingPrefix: "$t(",
        nestingSuffix: ")",
        nestingOptionsSeparator: ",",
        maxReplaces: 1e3,
        skipOnVariables: true
      }
    };
  }
  function transformOptions(options) {
    if (typeof options.ns === "string")
      options.ns = [options.ns];
    if (typeof options.fallbackLng === "string")
      options.fallbackLng = [options.fallbackLng];
    if (typeof options.fallbackNS === "string")
      options.fallbackNS = [options.fallbackNS];
    if (options.supportedLngs && options.supportedLngs.indexOf("cimode") < 0) {
      options.supportedLngs = options.supportedLngs.concat(["cimode"]);
    }
    return options;
  }
  function ownKeys(object2, enumerableOnly) {
    var keys = Object.keys(object2);
    if (Object.getOwnPropertySymbols) {
      var symbols = Object.getOwnPropertySymbols(object2);
      enumerableOnly && (symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object2, sym).enumerable;
      })), keys.push.apply(keys, symbols);
    }
    return keys;
  }
  function _objectSpread(target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = null != arguments[i] ? arguments[i] : {};
      i % 2 ? ownKeys(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      }) : Object.getOwnPropertyDescriptors ? Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)) : ownKeys(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
    return target;
  }
  function _createSuper(Derived) {
    var hasNativeReflectConstruct = _isNativeReflectConstruct();
    return function _createSuperInternal() {
      var Super = _getPrototypeOf(Derived), result3;
      if (hasNativeReflectConstruct) {
        var NewTarget = _getPrototypeOf(this).constructor;
        result3 = Reflect.construct(Super, arguments, NewTarget);
      } else {
        result3 = Super.apply(this, arguments);
      }
      return _possibleConstructorReturn(this, result3);
    };
  }
  function _isNativeReflectConstruct() {
    if (typeof Reflect === "undefined" || !Reflect.construct)
      return false;
    if (Reflect.construct.sham)
      return false;
    if (typeof Proxy === "function")
      return true;
    try {
      Boolean.prototype.valueOf.call(Reflect.construct(Boolean, [], function() {
      }));
      return true;
    } catch (e) {
      return false;
    }
  }
  function noop() {
  }
  function bindMemberFunctions(inst) {
    var mems = Object.getOwnPropertyNames(Object.getPrototypeOf(inst));
    mems.forEach(function(mem) {
      if (typeof inst[mem] === "function") {
        inst[mem] = inst[mem].bind(inst);
      }
    });
  }
  var I18n = function(_EventEmitter) {
    _inherits(I18n2, _EventEmitter);
    var _super = _createSuper(I18n2);
    function I18n2() {
      var _this;
      var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
      var callback = arguments.length > 1 ? arguments[1] : void 0;
      _classCallCheck(this, I18n2);
      _this = _super.call(this);
      if (isIE10) {
        EventEmitter.call(_assertThisInitialized(_this));
      }
      _this.options = transformOptions(options);
      _this.services = {};
      _this.logger = baseLogger;
      _this.modules = {
        external: []
      };
      bindMemberFunctions(_assertThisInitialized(_this));
      if (callback && !_this.isInitialized && !options.isClone) {
        if (!_this.options.initImmediate) {
          _this.init(options, callback);
          return _possibleConstructorReturn(_this, _assertThisInitialized(_this));
        }
        setTimeout(function() {
          _this.init(options, callback);
        }, 0);
      }
      return _this;
    }
    _createClass(I18n2, [{
      key: "init",
      value: function init2() {
        var _this2 = this;
        var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
        var callback = arguments.length > 1 ? arguments[1] : void 0;
        if (typeof options === "function") {
          callback = options;
          options = {};
        }
        if (!options.defaultNS && options.defaultNS !== false && options.ns) {
          if (typeof options.ns === "string") {
            options.defaultNS = options.ns;
          } else if (options.ns.indexOf("translation") < 0) {
            options.defaultNS = options.ns[0];
          }
        }
        var defOpts = get();
        this.options = _objectSpread(_objectSpread(_objectSpread({}, defOpts), this.options), transformOptions(options));
        if (this.options.compatibilityAPI !== "v1") {
          this.options.interpolation = _objectSpread(_objectSpread({}, defOpts.interpolation), this.options.interpolation);
        }
        if (options.keySeparator !== void 0) {
          this.options.userDefinedKeySeparator = options.keySeparator;
        }
        if (options.nsSeparator !== void 0) {
          this.options.userDefinedNsSeparator = options.nsSeparator;
        }
        function createClassOnDemand(ClassOrObject) {
          if (!ClassOrObject)
            return null;
          if (typeof ClassOrObject === "function")
            return new ClassOrObject();
          return ClassOrObject;
        }
        if (!this.options.isClone) {
          if (this.modules.logger) {
            baseLogger.init(createClassOnDemand(this.modules.logger), this.options);
          } else {
            baseLogger.init(null, this.options);
          }
          var formatter;
          if (this.modules.formatter) {
            formatter = this.modules.formatter;
          } else if (typeof Intl !== "undefined") {
            formatter = Formatter;
          }
          var lu = new LanguageUtil(this.options);
          this.store = new ResourceStore(this.options.resources, this.options);
          var s = this.services;
          s.logger = baseLogger;
          s.resourceStore = this.store;
          s.languageUtils = lu;
          s.pluralResolver = new PluralResolver(lu, {
            prepend: this.options.pluralSeparator,
            compatibilityJSON: this.options.compatibilityJSON,
            simplifyPluralSuffix: this.options.simplifyPluralSuffix
          });
          if (formatter && (!this.options.interpolation.format || this.options.interpolation.format === defOpts.interpolation.format)) {
            s.formatter = createClassOnDemand(formatter);
            s.formatter.init(s, this.options);
            this.options.interpolation.format = s.formatter.format.bind(s.formatter);
          }
          s.interpolator = new Interpolator(this.options);
          s.utils = {
            hasLoadedNamespace: this.hasLoadedNamespace.bind(this)
          };
          s.backendConnector = new Connector(createClassOnDemand(this.modules.backend), s.resourceStore, s, this.options);
          s.backendConnector.on("*", function(event) {
            for (var _len = arguments.length, args = new Array(_len > 1 ? _len - 1 : 0), _key = 1; _key < _len; _key++) {
              args[_key - 1] = arguments[_key];
            }
            _this2.emit.apply(_this2, [event].concat(args));
          });
          if (this.modules.languageDetector) {
            s.languageDetector = createClassOnDemand(this.modules.languageDetector);
            if (s.languageDetector.init)
              s.languageDetector.init(s, this.options.detection, this.options);
          }
          if (this.modules.i18nFormat) {
            s.i18nFormat = createClassOnDemand(this.modules.i18nFormat);
            if (s.i18nFormat.init)
              s.i18nFormat.init(this);
          }
          this.translator = new Translator(this.services, this.options);
          this.translator.on("*", function(event) {
            for (var _len2 = arguments.length, args = new Array(_len2 > 1 ? _len2 - 1 : 0), _key2 = 1; _key2 < _len2; _key2++) {
              args[_key2 - 1] = arguments[_key2];
            }
            _this2.emit.apply(_this2, [event].concat(args));
          });
          this.modules.external.forEach(function(m) {
            if (m.init)
              m.init(_this2);
          });
        }
        this.format = this.options.interpolation.format;
        if (!callback)
          callback = noop;
        if (this.options.fallbackLng && !this.services.languageDetector && !this.options.lng) {
          var codes = this.services.languageUtils.getFallbackCodes(this.options.fallbackLng);
          if (codes.length > 0 && codes[0] !== "dev")
            this.options.lng = codes[0];
        }
        if (!this.services.languageDetector && !this.options.lng) {
          this.logger.warn("init: no languageDetector is used and no lng is defined");
        }
        var storeApi = ["getResource", "hasResourceBundle", "getResourceBundle", "getDataByLanguage"];
        storeApi.forEach(function(fcName) {
          _this2[fcName] = function() {
            var _this2$store;
            return (_this2$store = _this2.store)[fcName].apply(_this2$store, arguments);
          };
        });
        var storeApiChained = ["addResource", "addResources", "addResourceBundle", "removeResourceBundle"];
        storeApiChained.forEach(function(fcName) {
          _this2[fcName] = function() {
            var _this2$store2;
            (_this2$store2 = _this2.store)[fcName].apply(_this2$store2, arguments);
            return _this2;
          };
        });
        var deferred = defer();
        var load = function load2() {
          var finish = function finish2(err, t2) {
            if (_this2.isInitialized && !_this2.initializedStoreOnce)
              _this2.logger.warn("init: i18next is already initialized. You should call init just once!");
            _this2.isInitialized = true;
            if (!_this2.options.isClone)
              _this2.logger.log("initialized", _this2.options);
            _this2.emit("initialized", _this2.options);
            deferred.resolve(t2);
            callback(err, t2);
          };
          if (_this2.languages && _this2.options.compatibilityAPI !== "v1" && !_this2.isInitialized)
            return finish(null, _this2.t.bind(_this2));
          _this2.changeLanguage(_this2.options.lng, finish);
        };
        if (this.options.resources || !this.options.initImmediate) {
          load();
        } else {
          setTimeout(load, 0);
        }
        return deferred;
      }
    }, {
      key: "loadResources",
      value: function loadResources2(language) {
        var _this3 = this;
        var callback = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : noop;
        var usedCallback = callback;
        var usedLng = typeof language === "string" ? language : this.language;
        if (typeof language === "function")
          usedCallback = language;
        if (!this.options.resources || this.options.partialBundledLanguages) {
          if (usedLng && usedLng.toLowerCase() === "cimode")
            return usedCallback();
          var toLoad = [];
          var append = function append2(lng) {
            if (!lng)
              return;
            var lngs = _this3.services.languageUtils.toResolveHierarchy(lng);
            lngs.forEach(function(l) {
              if (toLoad.indexOf(l) < 0)
                toLoad.push(l);
            });
          };
          if (!usedLng) {
            var fallbacks = this.services.languageUtils.getFallbackCodes(this.options.fallbackLng);
            fallbacks.forEach(function(l) {
              return append(l);
            });
          } else {
            append(usedLng);
          }
          if (this.options.preload) {
            this.options.preload.forEach(function(l) {
              return append(l);
            });
          }
          this.services.backendConnector.load(toLoad, this.options.ns, function(e) {
            if (!e && !_this3.resolvedLanguage && _this3.language)
              _this3.setResolvedLanguage(_this3.language);
            usedCallback(e);
          });
        } else {
          usedCallback(null);
        }
      }
    }, {
      key: "reloadResources",
      value: function reloadResources2(lngs, ns, callback) {
        var deferred = defer();
        if (!lngs)
          lngs = this.languages;
        if (!ns)
          ns = this.options.ns;
        if (!callback)
          callback = noop;
        this.services.backendConnector.reload(lngs, ns, function(err) {
          deferred.resolve();
          callback(err);
        });
        return deferred;
      }
    }, {
      key: "use",
      value: function use2(module) {
        if (!module)
          throw new Error("You are passing an undefined module! Please check the object you are passing to i18next.use()");
        if (!module.type)
          throw new Error("You are passing a wrong module! Please check the object you are passing to i18next.use()");
        if (module.type === "backend") {
          this.modules.backend = module;
        }
        if (module.type === "logger" || module.log && module.warn && module.error) {
          this.modules.logger = module;
        }
        if (module.type === "languageDetector") {
          this.modules.languageDetector = module;
        }
        if (module.type === "i18nFormat") {
          this.modules.i18nFormat = module;
        }
        if (module.type === "postProcessor") {
          postProcessor.addPostProcessor(module);
        }
        if (module.type === "formatter") {
          this.modules.formatter = module;
        }
        if (module.type === "3rdParty") {
          this.modules.external.push(module);
        }
        return this;
      }
    }, {
      key: "setResolvedLanguage",
      value: function setResolvedLanguage(l) {
        if (!l || !this.languages)
          return;
        if (["cimode", "dev"].indexOf(l) > -1)
          return;
        for (var li = 0; li < this.languages.length; li++) {
          var lngInLngs = this.languages[li];
          if (["cimode", "dev"].indexOf(lngInLngs) > -1)
            continue;
          if (this.store.hasLanguageSomeTranslations(lngInLngs)) {
            this.resolvedLanguage = lngInLngs;
            break;
          }
        }
      }
    }, {
      key: "changeLanguage",
      value: function changeLanguage2(lng, callback) {
        var _this4 = this;
        this.isLanguageChangingTo = lng;
        var deferred = defer();
        this.emit("languageChanging", lng);
        var setLngProps = function setLngProps2(l) {
          _this4.language = l;
          _this4.languages = _this4.services.languageUtils.toResolveHierarchy(l);
          _this4.resolvedLanguage = void 0;
          _this4.setResolvedLanguage(l);
        };
        var done = function done2(err, l) {
          if (l) {
            setLngProps(l);
            _this4.translator.changeLanguage(l);
            _this4.isLanguageChangingTo = void 0;
            _this4.emit("languageChanged", l);
            _this4.logger.log("languageChanged", l);
          } else {
            _this4.isLanguageChangingTo = void 0;
          }
          deferred.resolve(function() {
            return _this4.t.apply(_this4, arguments);
          });
          if (callback)
            callback(err, function() {
              return _this4.t.apply(_this4, arguments);
            });
        };
        var setLng = function setLng2(lngs) {
          if (!lng && !lngs && _this4.services.languageDetector)
            lngs = [];
          var l = typeof lngs === "string" ? lngs : _this4.services.languageUtils.getBestMatchFromCodes(lngs);
          if (l) {
            if (!_this4.language) {
              setLngProps(l);
            }
            if (!_this4.translator.language)
              _this4.translator.changeLanguage(l);
            if (_this4.services.languageDetector && _this4.services.languageDetector.cacheUserLanguage)
              _this4.services.languageDetector.cacheUserLanguage(l);
          }
          _this4.loadResources(l, function(err) {
            done(err, l);
          });
        };
        if (!lng && this.services.languageDetector && !this.services.languageDetector.async) {
          setLng(this.services.languageDetector.detect());
        } else if (!lng && this.services.languageDetector && this.services.languageDetector.async) {
          if (this.services.languageDetector.detect.length === 0) {
            this.services.languageDetector.detect().then(setLng);
          } else {
            this.services.languageDetector.detect(setLng);
          }
        } else {
          setLng(lng);
        }
        return deferred;
      }
    }, {
      key: "getFixedT",
      value: function getFixedT2(lng, ns, keyPrefix) {
        var _this5 = this;
        var fixedT = function fixedT2(key, opts) {
          var options;
          if (_typeof(opts) !== "object") {
            for (var _len3 = arguments.length, rest = new Array(_len3 > 2 ? _len3 - 2 : 0), _key3 = 2; _key3 < _len3; _key3++) {
              rest[_key3 - 2] = arguments[_key3];
            }
            options = _this5.options.overloadTranslationOptionHandler([key, opts].concat(rest));
          } else {
            options = _objectSpread({}, opts);
          }
          options.lng = options.lng || fixedT2.lng;
          options.lngs = options.lngs || fixedT2.lngs;
          options.ns = options.ns || fixedT2.ns;
          options.keyPrefix = options.keyPrefix || keyPrefix || fixedT2.keyPrefix;
          var keySeparator = _this5.options.keySeparator || ".";
          var resultKey;
          if (options.keyPrefix && Array.isArray(key)) {
            resultKey = key.map(function(k) {
              return "".concat(options.keyPrefix).concat(keySeparator).concat(k);
            });
          } else {
            resultKey = options.keyPrefix ? "".concat(options.keyPrefix).concat(keySeparator).concat(key) : key;
          }
          return _this5.t(resultKey, options);
        };
        if (typeof lng === "string") {
          fixedT.lng = lng;
        } else {
          fixedT.lngs = lng;
        }
        fixedT.ns = ns;
        fixedT.keyPrefix = keyPrefix;
        return fixedT;
      }
    }, {
      key: "t",
      value: function t2() {
        var _this$translator;
        return this.translator && (_this$translator = this.translator).translate.apply(_this$translator, arguments);
      }
    }, {
      key: "exists",
      value: function exists2() {
        var _this$translator2;
        return this.translator && (_this$translator2 = this.translator).exists.apply(_this$translator2, arguments);
      }
    }, {
      key: "setDefaultNamespace",
      value: function setDefaultNamespace2(ns) {
        this.options.defaultNS = ns;
      }
    }, {
      key: "hasLoadedNamespace",
      value: function hasLoadedNamespace2(ns) {
        var _this6 = this;
        var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
        if (!this.isInitialized) {
          this.logger.warn("hasLoadedNamespace: i18next was not initialized", this.languages);
          return false;
        }
        if (!this.languages || !this.languages.length) {
          this.logger.warn("hasLoadedNamespace: i18n.languages were undefined or empty", this.languages);
          return false;
        }
        var lng = this.resolvedLanguage || this.languages[0];
        var fallbackLng = this.options ? this.options.fallbackLng : false;
        var lastLng = this.languages[this.languages.length - 1];
        if (lng.toLowerCase() === "cimode")
          return true;
        var loadNotPending = function loadNotPending2(l, n) {
          var loadState = _this6.services.backendConnector.state["".concat(l, "|").concat(n)];
          return loadState === -1 || loadState === 2;
        };
        if (options.precheck) {
          var preResult = options.precheck(this, loadNotPending);
          if (preResult !== void 0)
            return preResult;
        }
        if (this.hasResourceBundle(lng, ns))
          return true;
        if (!this.services.backendConnector.backend || this.options.resources && !this.options.partialBundledLanguages)
          return true;
        if (loadNotPending(lng, ns) && (!fallbackLng || loadNotPending(lastLng, ns)))
          return true;
        return false;
      }
    }, {
      key: "loadNamespaces",
      value: function loadNamespaces2(ns, callback) {
        var _this7 = this;
        var deferred = defer();
        if (!this.options.ns) {
          if (callback)
            callback();
          return Promise.resolve();
        }
        if (typeof ns === "string")
          ns = [ns];
        ns.forEach(function(n) {
          if (_this7.options.ns.indexOf(n) < 0)
            _this7.options.ns.push(n);
        });
        this.loadResources(function(err) {
          deferred.resolve();
          if (callback)
            callback(err);
        });
        return deferred;
      }
    }, {
      key: "loadLanguages",
      value: function loadLanguages2(lngs, callback) {
        var deferred = defer();
        if (typeof lngs === "string")
          lngs = [lngs];
        var preloaded = this.options.preload || [];
        var newLngs = lngs.filter(function(lng) {
          return preloaded.indexOf(lng) < 0;
        });
        if (!newLngs.length) {
          if (callback)
            callback();
          return Promise.resolve();
        }
        this.options.preload = preloaded.concat(newLngs);
        this.loadResources(function(err) {
          deferred.resolve();
          if (callback)
            callback(err);
        });
        return deferred;
      }
    }, {
      key: "dir",
      value: function dir2(lng) {
        if (!lng)
          lng = this.resolvedLanguage || (this.languages && this.languages.length > 0 ? this.languages[0] : this.language);
        if (!lng)
          return "rtl";
        var rtlLngs = ["ar", "shu", "sqr", "ssh", "xaa", "yhd", "yud", "aao", "abh", "abv", "acm", "acq", "acw", "acx", "acy", "adf", "ads", "aeb", "aec", "afb", "ajp", "apc", "apd", "arb", "arq", "ars", "ary", "arz", "auz", "avl", "ayh", "ayl", "ayn", "ayp", "bbz", "pga", "he", "iw", "ps", "pbt", "pbu", "pst", "prp", "prd", "ug", "ur", "ydd", "yds", "yih", "ji", "yi", "hbo", "men", "xmn", "fa", "jpr", "peo", "pes", "prs", "dv", "sam", "ckb"];
        var languageUtils = this.services && this.services.languageUtils || new LanguageUtil(get());
        return rtlLngs.indexOf(languageUtils.getLanguagePartFromCode(lng)) > -1 || lng.toLowerCase().indexOf("-arab") > 1 ? "rtl" : "ltr";
      }
    }, {
      key: "cloneInstance",
      value: function cloneInstance() {
        var _this8 = this;
        var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
        var callback = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : noop;
        var mergedOptions = _objectSpread(_objectSpread(_objectSpread({}, this.options), options), {
          isClone: true
        });
        var clone2 = new I18n2(mergedOptions);
        if (options.debug !== void 0 || options.prefix !== void 0) {
          clone2.logger = clone2.logger.clone(options);
        }
        var membersToCopy = ["store", "services", "language"];
        membersToCopy.forEach(function(m) {
          clone2[m] = _this8[m];
        });
        clone2.services = _objectSpread({}, this.services);
        clone2.services.utils = {
          hasLoadedNamespace: clone2.hasLoadedNamespace.bind(clone2)
        };
        clone2.translator = new Translator(clone2.services, clone2.options);
        clone2.translator.on("*", function(event) {
          for (var _len4 = arguments.length, args = new Array(_len4 > 1 ? _len4 - 1 : 0), _key4 = 1; _key4 < _len4; _key4++) {
            args[_key4 - 1] = arguments[_key4];
          }
          clone2.emit.apply(clone2, [event].concat(args));
        });
        clone2.init(mergedOptions, callback);
        clone2.translator.options = clone2.options;
        clone2.translator.backendConnector.services.utils = {
          hasLoadedNamespace: clone2.hasLoadedNamespace.bind(clone2)
        };
        return clone2;
      }
    }, {
      key: "toJSON",
      value: function toJSON() {
        return {
          options: this.options,
          store: this.store,
          language: this.language,
          languages: this.languages,
          resolvedLanguage: this.resolvedLanguage
        };
      }
    }]);
    return I18n2;
  }(EventEmitter);
  _defineProperty(I18n, "createInstance", function() {
    var options = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : {};
    var callback = arguments.length > 1 ? arguments[1] : void 0;
    return new I18n(options, callback);
  });
  var instance = I18n.createInstance();
  instance.createInstance = I18n.createInstance;
  var createInstance = instance.createInstance;
  var dir = instance.dir;
  var init = instance.init;
  var loadResources = instance.loadResources;
  var reloadResources = instance.reloadResources;
  var use = instance.use;
  var changeLanguage = instance.changeLanguage;
  var getFixedT = instance.getFixedT;
  var t = instance.t;
  var exists = instance.exists;
  var setDefaultNamespace = instance.setDefaultNamespace;
  var hasLoadedNamespace = instance.hasLoadedNamespace;
  var loadNamespaces = instance.loadNamespaces;
  var loadLanguages = instance.loadLanguages;

  // src/utils/import.ts
  var hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  var isRecord = (value) => typeof value === "object" && value !== null;
  var asConfigCarrier = (value) => isRecord(value) ? value : {};
  var extractConfigOverrides = (value) => {
    const source = asConfigCarrier(value);
    const overrides = {};
    if (typeof source.temperature === "number")
      overrides.temperature = source.temperature;
    if (typeof source.max_tokens === "number")
      overrides.max_tokens = source.max_tokens;
    if (typeof source.top_p === "number")
      overrides.top_p = source.top_p;
    if (typeof source.frequency_penalty === "number") {
      overrides.frequency_penalty = source.frequency_penalty;
    }
    if (typeof source.presence_penalty === "number") {
      overrides.presence_penalty = source.presence_penalty;
    }
    if (typeof source.model === "string" && source.model.length > 0) {
      overrides.model = source.model;
    }
    return overrides;
  };
  var buildImportedConfig = (value) => ({
    ..._defaultChatConfig,
    ...extractConfigOverrides(value)
  });
  var isOpenAIMessageContentParts = (value) => isRecord(value) && hasOwn(value, "parts") && Array.isArray(value.parts) && value.parts.every((part) => typeof part === "string");
  var isRole = (value) => typeof value === "string" && roles.includes(value);
  var validateAndFixChats = (chats) => {
    if (!Array.isArray(chats))
      return false;
    for (const chat of chats) {
      if (!isRecord(chat))
        return false;
      const mutableChat = chat;
      if (!(typeof mutableChat.id === "string"))
        mutableChat.id = editingUUID();
      if (!(typeof mutableChat.title === "string") || mutableChat.title === "")
        return false;
      if (mutableChat.titleSet === void 0)
        mutableChat.titleSet = false;
      if (!(typeof mutableChat.titleSet === "boolean"))
        return false;
      if (!validateMessage(mutableChat.messages))
        return false;
      if (!validateAndFixChatConfig(mutableChat.config))
        return false;
      if (mutableChat.summaryTargets !== void 0 && (!isRecord(mutableChat.summaryTargets) || Object.values(mutableChat.summaryTargets).some((value) => typeof value !== "boolean")))
        return false;
      if (mutableChat.summaries !== void 0 && (!Array.isArray(mutableChat.summaries) || !mutableChat.summaries.every(isBubbleSummary)))
        return false;
    }
    ensureUniqueChatIds(chats);
    return true;
  };
  var validateMessage = (messages) => {
    if (!Array.isArray(messages))
      return false;
    for (const message of messages) {
      if (!isRecord(message))
        return false;
      if (typeof message.content === "string") {
        message.content = [strToTextContent(message.content)];
      } else if (!Array.isArray(message.content)) {
        return false;
      }
      if (!(typeof message.role === "string"))
        return false;
      if (!roles.includes(message.role))
        return false;
    }
    return true;
  };
  var validateAndFixChatConfig = (config) => {
    if (config === void 0)
      return true;
    if (!isRecord(config))
      return false;
    if (config.temperature === void 0)
      config.temperature = _defaultChatConfig.temperature;
    if (!(typeof config.temperature === "number"))
      return false;
    if (config.presence_penalty === void 0)
      config.presence_penalty = _defaultChatConfig.presence_penalty;
    if (!(typeof config.presence_penalty === "number"))
      return false;
    if (config.top_p === void 0)
      config.top_p = _defaultChatConfig.top_p;
    if (!(typeof config.top_p === "number"))
      return false;
    if (config.frequency_penalty === void 0)
      config.frequency_penalty = _defaultChatConfig.frequency_penalty;
    if (!(typeof config.frequency_penalty === "number"))
      return false;
    config.model = typeof config.model === "string" && config.model.length > 0 ? config.model : defaultModel;
    return true;
  };
  var isLegacyImport = (importedData) => Array.isArray(importedData);
  var isSingleChatImport = (importedData) => isRecord(importedData) && hasOwn(importedData, "messages") && Array.isArray(importedData.messages) && hasOwn(importedData, "config") && isRecord(importedData.config);
  var validateFolders = (folders) => {
    return validateFolderHierarchy(folders);
  };
  var validateExportV1 = (data) => {
    return validateAndFixChats(data.chats) && validateFolders(data.folders);
  };
  var validateExportV2 = (data) => {
    if (!validateAndFixChats(data.chats) || !validateFolders(data.folders))
      return false;
    if (data.chats) {
      for (const chat of data.chats) {
        if (chat.branchTree) {
          const bt = chat.branchTree;
          if (typeof bt.nodes !== "object" || !Array.isArray(bt.activePath))
            return false;
        }
      }
    }
    return true;
  };
  var validateContentStore = (contentStore) => {
    if (!isRecord(contentStore))
      return false;
    for (const entry of Object.values(contentStore)) {
      if (!isRecord(entry))
        return false;
      if (!Array.isArray(entry.content))
        return false;
      if (typeof entry.refCount !== "number")
        return false;
      if (!entry.content.every(isContentInterface))
        return false;
    }
    return true;
  };
  var isEvaluationSettings = (value) => {
    if (!isRecord(value))
      return false;
    const modes = ["manual", "auto"];
    return modes.includes(value.safetyPreSend) && modes.includes(value.safetyPostReceive) && modes.includes(value.qualityPreSend) && modes.includes(value.qualityPostReceive);
  };
  var isEvaluationResultMap = (value) => {
    if (!isRecord(value))
      return false;
    return Object.values(value).every((entry) => {
      if (!isRecord(entry))
        return false;
      if (entry.phase !== "pre-send" && entry.phase !== "post-receive")
        return false;
      return true;
    });
  };
  var validateExportV3 = (data) => {
    if (!validateAndFixChats(data.chats) || !validateFolders(data.folders) || !validateContentStore(data.contentStore)) {
      return false;
    }
    if (data.chats) {
      for (const chat of data.chats) {
        if (!chat.branchTree)
          continue;
        const bt = chat.branchTree;
        if (typeof bt.nodes !== "object" || !Array.isArray(bt.activePath)) {
          return false;
        }
        for (const nodeId of bt.activePath) {
          const node = bt.nodes[nodeId];
          if (!node || typeof node.contentHash !== "string") {
            return false;
          }
        }
      }
    }
    if (data.evaluationSettings !== void 0 && !isEvaluationSettings(data.evaluationSettings)) {
      return false;
    }
    if (data.evaluationResults !== void 0 && !isEvaluationResultMap(data.evaluationResults)) {
      return false;
    }
    return true;
  };
  var isContentInterface = (content) => {
    if (!isRecord(content) || typeof content.type !== "string")
      return false;
    if (content.type === "text") {
      return typeof content.text === "string";
    }
    if (content.type === "image_url") {
      return isRecord(content.image_url) && typeof content.image_url.url === "string" && typeof content.image_url.detail === "string";
    }
    if (content.type === "reasoning") {
      return typeof content.text === "string";
    }
    if (content.type === "tool_call") {
      return typeof content.id === "string" && typeof content.name === "string" && typeof content.arguments === "string";
    }
    if (content.type === "tool_result") {
      return typeof content.tool_call_id === "string" && typeof content.content === "string";
    }
    return false;
  };
  var isOpenAIContent = (content) => {
    return isOpenAIChat(content) || isOpenAIPlaygroundJSON(content) || isOpenAIDataExport(content);
  };
  var isOpenAIChat = (content) => {
    return isRecord(content) && hasOwn(content, "mapping") && isRecord(content.mapping);
  };
  var isOpenAIDataExport = (content) => {
    return Array.isArray(content) && content.length > 0 && isOpenAIChat(content[0]);
  };
  var isOpenAIPlaygroundJSON = (content) => {
    if (!isRecord(content) || !hasOwn(content, "messages") || !Array.isArray(content.messages)) {
      return false;
    }
    if (hasOwn(content, "config") || hasOwn(content, "version")) {
      return false;
    }
    return true;
  };
  var PartialImportError = class extends Error {
    constructor(message, result3) {
      super(message);
      this.result = result3;
      this.name = "PartialImportError";
    }
  };
  var convertOpenAIToConversationFormatPartialOK = (openAIChatExport) => {
    return convertOpenAIToConversationFormat(openAIChatExport, true);
  };
  var convertOpenAIToConversationFormatPartialNTY = (openAIChatExport) => {
    return convertOpenAIToConversationFormat(openAIChatExport, false);
  };
  var convertOpenAIToConversationFormat = (openAIChatExport, shouldAllowPartialImport) => {
    const messages = [];
    let maxDepth = -1;
    const deepestPathIds = [];
    const upwardPathIds = [];
    const messageIds = [];
    const emptyOrNullMessageIds = [];
    let emptyOrNullMessagesCount = 0;
    if (isOpenAIChat(openAIChatExport)) {
      let deepestNode = null;
      const traverseTree = (id, currentDepth2) => {
        const node = openAIChatExport.mapping[id];
        if (currentDepth2 > maxDepth) {
          deepestNode = node;
          maxDepth = currentDepth2;
        }
        for (const childId of node.children) {
          traverseTree(childId, currentDepth2 + 1);
        }
      };
      const rootNode = openAIChatExport.mapping[Object.keys(openAIChatExport.mapping)[0]];
      traverseTree(rootNode.id, 0);
      let currentDepth = 0;
      while (deepestNode) {
        deepestPathIds.push(deepestNode.id);
        if (deepestNode.message) {
          const { role } = deepestNode.message.author;
          const content = deepestNode.message.content;
          if (isOpenAIMessageContentParts(content)) {
            const textContent = content.parts.join("") || "";
            if (textContent.length > 0) {
              if (!isRole(role)) {
                emptyOrNullMessagesCount++;
                emptyOrNullMessageIds.push(deepestNode.id);
                continue;
              }
              messages.unshift({
                role,
                content: [{ type: "text", text: textContent }]
              });
              messageIds.push(deepestNode.id);
            } else {
              emptyOrNullMessagesCount++;
              emptyOrNullMessageIds.push(deepestNode.id);
            }
          } else if (isContentInterface(content)) {
            if (!isRole(role)) {
              emptyOrNullMessagesCount++;
              emptyOrNullMessageIds.push(deepestNode.id);
              continue;
            }
            messages.unshift({ role, content: [content] });
            messageIds.push(deepestNode.id);
          } else {
            emptyOrNullMessagesCount++;
            emptyOrNullMessageIds.push(deepestNode.id);
          }
        } else {
          emptyOrNullMessagesCount++;
          emptyOrNullMessageIds.push(deepestNode.id);
        }
        const parentNodeId = deepestNode.parent ? deepestNode.parent : null;
        deepestNode = parentNodeId ? openAIChatExport.mapping[parentNodeId] : null;
        currentDepth++;
      }
      for (let i = deepestPathIds.length - 1; i >= 0; i--) {
        upwardPathIds.push(deepestPathIds[i]);
      }
      const diffDeepestToMessages = deepestPathIds.filter((id) => !messageIds.includes(id));
      const diffDeepestToMessagesAndEmpty = diffDeepestToMessages.filter((id) => !emptyOrNullMessageIds.includes(id));
      if (!shouldAllowPartialImport) {
        if (diffDeepestToMessagesAndEmpty.length > 0) {
          const config2 = buildImportedConfig(openAIChatExport);
          const result3 = {
            id: editingUUID(),
            title: openAIChatExport.title || "Untitled Chat",
            messages,
            config: config2,
            titleSet: true,
            imageDetail: _defaultImageDetail
          };
          throw new PartialImportError(
            instance.t("partialImportMessages", {
              ns: "import",
              total: deepestPathIds.length,
              count: messageIds.length
            }),
            result3
          );
        }
      }
    } else if (isOpenAIPlaygroundJSON(openAIChatExport)) {
      openAIChatExport.messages.forEach((message) => {
        const { role } = message;
        const content = typeof message.content === "string" ? [strToTextContent(message.content)] : message.content;
        if (Array.isArray(content)) {
          const contentElements = content.map((part) => {
            if (isTextContent(part)) {
              return { type: "text", text: part.text };
            } else if (isImageContent(part)) {
              return {
                type: "image_url",
                image_url: {
                  url: part.image_url.url,
                  detail: part.image_url.detail || "auto"
                }
              };
            }
            return null;
          }).filter((part) => part !== null);
          if (contentElements.length > 0) {
            messages.push({
              role,
              content: contentElements
            });
          }
        }
      });
    }
    const config = buildImportedConfig(openAIChatExport);
    return {
      id: editingUUID(),
      title: "title" in openAIChatExport && typeof openAIChatExport.title === "string" ? openAIChatExport.title : "Untitled Chat",
      messages,
      config,
      titleSet: true,
      imageDetail: _defaultImageDetail
    };
  };
  var importOpenAIChatExport = (openAIChatExport, shouldAllowPartialImport) => {
    if (Array.isArray(openAIChatExport)) {
      if (shouldAllowPartialImport) {
        return openAIChatExport.map(convertOpenAIToConversationFormatPartialOK);
      } else {
        return openAIChatExport.map(convertOpenAIToConversationFormatPartialNTY);
      }
    } else {
      return [
        convertOpenAIToConversationFormat(
          openAIChatExport,
          shouldAllowPartialImport
        )
      ];
    }
    return [];
  };

  // src/utils/chatExport.ts
  var clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  var prepareChatForExport = (chat, sourceContentStore, options = {}) => {
    const visibleBranchOnly = options.visibleBranchOnly ?? false;
    if (!chat.branchTree) {
      return {
        chat: clone(chat),
        contentStore: {}
      };
    }
    chat = clone(chat);
    captureProjectedMessageAttributes(chat, sourceContentStore);
    const sourceTree = chat.branchTree;
    const includedNodeIds = visibleBranchOnly ? sourceTree.activePath.filter((id) => sourceTree.nodes[id] !== void 0) : Object.keys(sourceTree.nodes);
    const includedNodeSet = new Set(includedNodeIds);
    const activePath = sourceTree.activePath.filter((id) => includedNodeSet.has(id));
    const nodes = Object.fromEntries(
      includedNodeIds.map((id) => [id, clone(sourceTree.nodes[id])])
    );
    const hashRefCounts = /* @__PURE__ */ new Map();
    includedNodeIds.forEach((id) => {
      const node = sourceTree.nodes[id];
      hashRefCounts.set(node.contentHash, (hashRefCounts.get(node.contentHash) ?? 0) + 1);
    });
    const contentStore = {};
    hashRefCounts.forEach((refCount, hash) => {
      const entry = sourceContentStore[hash];
      if (!entry)
        return;
      const { delta, ...fullEntry } = entry;
      const content = delta ? resolveContent(sourceContentStore, hash) : entry.content;
      contentStore[hash] = clone({
        ...fullEntry,
        content,
        refCount
      });
    });
    const filterNodeRecord = (record) => record ? Object.fromEntries(
      Object.entries(record).filter(([id]) => includedNodeSet.has(id))
    ) : void 0;
    const collapsedNodes = filterNodeRecord(chat.collapsedNodes);
    const omittedNodes = filterNodeRecord(chat.omittedNodes);
    const protectedNodes = filterNodeRecord(chat.protectedNodes);
    const summaryTargets = filterNodeRecord(chat.summaryTargets);
    const summaries = chat.summaries?.filter((summary) => summary.sources.every(
      (source) => includedNodeSet.has(source.nodeId) && (source.parentId === null || includedNodeSet.has(source.parentId))
    ));
    const exportedChat = clone(chat);
    return {
      chat: {
        ...exportedChat,
        messages: clone(materializeActivePath({ ...sourceTree, activePath }, sourceContentStore, true)),
        branchTree: {
          ...exportedChat.branchTree,
          nodes,
          ...sourceTree.messageAttributesV1 ? { messageAttributesV1: { version: 1, byNode: Object.fromEntries(Object.entries(readMessageAttributes(sourceTree).byNode).filter(([id]) => includedNodeSet.has(id))) } } : {},
          rootId: includedNodeSet.has(sourceTree.rootId) ? sourceTree.rootId : activePath[0] ?? includedNodeIds[0] ?? "",
          activePath
        },
        collapsedNodes,
        omittedNodes,
        protectedNodes,
        summaryTargets,
        summaries
      },
      contentStore
    };
  };
  var contentToTextParts = (content) => {
    return content.filter(isTextContent).map((c) => c.text);
  };
  var contentToString = (content) => {
    return contentToTextParts(content).join("\n");
  };
  var chatToOpenAIFormat = (chat, contentStore, options = {}) => {
    const visibleBranchOnly = options.visibleBranchOnly ?? false;
    const modelSlug = chat.config?.model ?? "";
    const configSystemPrompt = chat.config?.systemPrompt;
    const mapping = {};
    if (chat.branchTree) {
      const tree = chat.branchTree;
      const nodeIds = visibleBranchOnly ? tree.activePath.filter((id) => tree.nodes[id] !== void 0) : Object.keys(tree.nodes);
      const filteredIds = nodeIds.filter((id) => tree.nodes[id]?.role !== "system");
      const nodeSet = new Set(filteredIds);
      const childrenMap = {};
      for (const id of filteredIds) {
        childrenMap[id] = [];
      }
      for (const id of filteredIds) {
        const node = tree.nodes[id];
        if (node.parentId && nodeSet.has(node.parentId)) {
          childrenMap[node.parentId].push(id);
        }
      }
      let systemNodeId = null;
      if (configSystemPrompt) {
        systemNodeId = "__system__";
        const firstNonSystem = filteredIds.find((id) => {
          const n = tree.nodes[id];
          return n && !n.parentId;
        }) ?? filteredIds[0];
        mapping[systemNodeId] = {
          id: systemNodeId,
          message: {
            author: { role: "system" },
            content: { parts: [configSystemPrompt] },
            metadata: { model_slug: modelSlug }
          },
          parent: null,
          children: firstNonSystem ? [firstNonSystem] : []
        };
      }
      for (const id of filteredIds) {
        const node = tree.nodes[id];
        const content = resolveContent(contentStore, node.contentHash);
        const parts = contentToTextParts(content);
        const parentInSet = node.parentId && nodeSet.has(node.parentId) ? node.parentId : null;
        mapping[id] = {
          id,
          message: {
            author: { role: node.role },
            content: { parts },
            metadata: { model_slug: modelSlug }
          },
          parent: parentInSet ?? systemNodeId,
          children: childrenMap[id] ?? []
        };
      }
      const activePath = tree.activePath.filter((id) => nodeSet.has(id));
      const currentNode = activePath[activePath.length - 1] ?? filteredIds[0] ?? systemNodeId ?? "";
      return {
        title: chat.title,
        create_time: tree.nodes[tree.rootId]?.createdAt ? Math.floor(tree.nodes[tree.rootId].createdAt / 1e3) : void 0,
        mapping,
        current_node: currentNode
      };
    }
    let parentId = null;
    const ids = [];
    if (configSystemPrompt) {
      const sysId = "msg-system";
      ids.push(sysId);
      mapping[sysId] = {
        id: sysId,
        message: {
          author: { role: "system" },
          content: { parts: [configSystemPrompt] },
          metadata: { model_slug: modelSlug }
        },
        parent: null,
        children: []
      };
      parentId = sysId;
    }
    chat.messages.forEach((msg, i) => {
      if (msg.role === "system")
        return;
      const id = `msg-${i}`;
      ids.push(id);
      const parts = contentToTextParts(msg.content);
      mapping[id] = {
        id,
        message: {
          author: { role: msg.role },
          content: { parts },
          metadata: { model_slug: modelSlug }
        },
        parent: parentId,
        children: []
      };
      if (parentId && mapping[parentId]) {
        mapping[parentId].children.push(id);
      }
      parentId = id;
    });
    return {
      title: chat.title,
      mapping,
      current_node: ids[ids.length - 1] ?? ""
    };
  };
  var _orCounter = 0;
  var orId = (prefix) => `${prefix}-${Date.now()}-${(++_orCounter).toString(36)}`;
  var chatToOpenRouterFormat = (chat, contentStore) => {
    const modelSlug = chat.config?.model ?? "";
    const characterId = orId("char");
    const now = new Date().toISOString();
    const character = {
      id: characterId,
      model: modelSlug,
      modelInfo: { slug: modelSlug, name: modelSlug },
      description: "",
      includeDefaultSystemPrompt: true,
      isStreaming: true,
      samplingParameters: {},
      chatMemory: 8,
      isDisabled: false,
      isRemoved: false,
      createdAt: now,
      updatedAt: now,
      plugins: []
    };
    const characters = { [characterId]: character };
    const messages = {};
    const items = {};
    let prevMsgId;
    const addMessage = (role, text, timestamp) => {
      const msgId = orId("msg");
      const itemId = orId("item");
      const ts = timestamp ? new Date(timestamp).toISOString() : now;
      const isUser = role === "user";
      const item = {
        id: itemId,
        messageId: msgId,
        data: {
          type: "message",
          role,
          content: [{ type: isUser ? "input_text" : "output_text", text }]
        }
      };
      items[itemId] = item;
      const msg = {
        id: msgId,
        characterId: isUser ? "USER" : characterId,
        contentType: "text",
        context: "main-chat",
        createdAt: ts,
        updatedAt: ts,
        isRetrying: false,
        isEdited: false,
        isCollapsed: false,
        type: role,
        items: [{ id: itemId, type: "message" }]
      };
      if (prevMsgId) {
        msg.parentMessageId = prevMsgId;
      }
      if (!isUser) {
        msg.isGenerating = false;
      }
      messages[msgId] = msg;
      prevMsgId = msgId;
    };
    if (chat.config?.systemPrompt) {
      addMessage("system", chat.config?.systemPrompt);
    }
    if (chat.branchTree) {
      for (const id of chat.branchTree.activePath) {
        const node = chat.branchTree.nodes[id];
        if (!node || node.role === "system")
          continue;
        const content = resolveContent(contentStore, node.contentHash);
        addMessage(node.role, contentToString(content), node.createdAt);
      }
    } else {
      for (const msg of chat.messages) {
        if (msg.role === "system")
          continue;
        addMessage(msg.role, contentToString(msg.content));
      }
    }
    return {
      version: "orpg.3.0",
      title: chat.title,
      characters,
      messages,
      items,
      artifacts: {},
      artifactFiles: {},
      artifactVersions: {},
      artifactFileContents: {}
    };
  };
  var lmsStepId = () => `${Date.now()}-${Math.random().toString().slice(2, 18)}`;
  var toLMStudioMessage = (role, text, modelSlug) => {
    if (role === "assistant") {
      const stepId = lmsStepId();
      const contentBlock = {
        type: "contentBlock",
        stepIdentifier: stepId,
        content: [{
          type: "text",
          text,
          fromDraftModel: false,
          tokensCount: 0,
          isStructural: false
        }],
        genInfo: {
          indexedModelIdentifier: modelSlug,
          identifier: modelSlug
        },
        defaultShouldIncludeInContext: true,
        shouldIncludeInContext: true
      };
      const version2 = {
        type: "multiStep",
        role: "assistant",
        senderInfo: { senderName: modelSlug },
        steps: [contentBlock]
      };
      return { versions: [version2], currentlySelected: 0 };
    }
    const version = {
      type: "singleStep",
      role,
      content: [{ type: "text", text }]
    };
    return { versions: [version], currentlySelected: 0 };
  };
  var chatToLMStudioFormat = (chat, contentStore, options = {}) => {
    const visibleBranchOnly = options.visibleBranchOnly ?? false;
    const modelSlug = chat.config?.model ?? "";
    const now = Date.now();
    const messages = [];
    let tokenCount = 0;
    let userLastMessagedAt;
    let assistantLastMessagedAt;
    const systemPrompt = chat.config?.systemPrompt ?? "";
    const addMsg = (role, text, timestamp) => {
      if (!text)
        return;
      if (role === "system")
        return;
      messages.push(toLMStudioMessage(role, text, modelSlug));
      if (role === "user" && timestamp)
        userLastMessagedAt = timestamp;
      if (role === "assistant" && timestamp)
        assistantLastMessagedAt = timestamp;
    };
    if (chat.branchTree) {
      const tree = chat.branchTree;
      const nodeIds = visibleBranchOnly ? tree.activePath.filter((id) => tree.nodes[id] !== void 0) : tree.activePath;
      for (const id of nodeIds) {
        const node = tree.nodes[id];
        if (!node)
          continue;
        const content = resolveContent(contentStore, node.contentHash);
        addMsg(node.role, contentToString(content), node.createdAt);
      }
    } else {
      for (const msg of chat.messages) {
        addMsg(msg.role, contentToString(msg.content));
      }
    }
    return {
      name: chat.title,
      pinned: false,
      createdAt: chat.branchTree?.nodes[chat.branchTree.rootId]?.createdAt ?? now,
      preset: "",
      tokenCount,
      userLastMessagedAt,
      assistantLastMessagedAt,
      systemPrompt,
      messages,
      usePerChatPredictionConfig: false,
      perChatPredictionConfig: { fields: [] },
      clientInput: "",
      clientInputFiles: [],
      userFilesSizeBytes: 0,
      lastUsedModel: {
        identifier: modelSlug,
        indexedModelIdentifier: modelSlug,
        instanceLoadTimeConfig: { fields: [] },
        instanceOperationTimeConfig: { fields: [] }
      },
      notes: [],
      plugins: [],
      pluginConfigs: {},
      disabledPluginTools: [],
      looseFiles: []
    };
  };

  // src/utils/systemPromptNormalize.ts
  function extractTextFromContent(content) {
    return content.filter(isTextContent).map((c) => c.text).filter(Boolean).join("\n");
  }
  function normalizeSystemPrompt(chat, contentStore) {
    if (!chat.branchTree && chat.messages.some((message) => message.role === "system" && Object.keys(message).some((key) => key !== "role" && key !== "content"))) {
      flatChatToBranchTree(chat, contentStore);
    }
    captureProjectedMessageAttributes(chat, contentStore);
    if (chat.branchTree) {
      normalizeWithBranchTree(chat, contentStore);
    } else {
      normalizeFlat(chat);
    }
  }
  function normalizeFlat(chat) {
    const systemTexts = [];
    const nonSystemMessages = [];
    for (const msg of chat.messages) {
      if (msg.role === "system") {
        const text = extractTextFromContent(msg.content);
        if (text)
          systemTexts.push(text);
      } else {
        nonSystemMessages.push(msg);
      }
    }
    if (systemTexts.length > 0) {
      const existing = chat.config.systemPrompt ?? "";
      const parts = existing ? [existing] : [];
      for (const text of systemTexts) {
        if (!existing.includes(text)) {
          parts.push(text);
        }
      }
      chat.config.systemPrompt = parts.join("\n\n");
    }
    chat.messages = nonSystemMessages;
  }
  function normalizeWithBranchTree(chat, contentStore) {
    const tree = chat.branchTree;
    const { nodes } = tree;
    const collectedSystemTexts = [];
    const systemNodeIds = /* @__PURE__ */ new Set();
    for (const [id, node] of Object.entries(nodes)) {
      if (node.role === "system") {
        systemNodeIds.add(id);
        const content = resolveContent(contentStore, node.contentHash);
        const text = extractTextFromContent(content);
        if (text)
          collectedSystemTexts.push(text);
      }
    }
    if (collectedSystemTexts.length > 0) {
      const existingParts = [];
      if (chat.config.systemPrompt)
        existingParts.push(chat.config.systemPrompt);
      const existing = chat.config.systemPrompt ?? "";
      for (const text of collectedSystemTexts) {
        if (!existing.includes(text)) {
          existingParts.push(text);
        }
      }
      chat.config.systemPrompt = existingParts.join("\n\n");
    }
    const activeRootId = tree.activePath[0];
    const activeRootIsSystem = activeRootId && nodes[activeRootId]?.role === "system";
    for (const sysId of systemNodeIds) {
      if (sysId === activeRootId && activeRootIsSystem)
        continue;
      const sysNode = nodes[sysId];
      if (!sysNode)
        continue;
      for (const [id, node] of Object.entries(nodes)) {
        if (node.parentId === sysId) {
          nodes[id] = { ...node, parentId: sysNode.parentId };
        }
      }
      const apIdx = tree.activePath.indexOf(sysId);
      if (apIdx >= 0) {
        tree.activePath.splice(apIdx, 1);
      }
      if (!readMessageAttributes(tree)?.byNode[sysId])
        delete nodes[sysId];
    }
    const topNodeId = tree.activePath[0];
    const topNode = topNodeId ? nodes[topNodeId] : void 0;
    if (chat.config.systemPrompt) {
      const systemContent = [
        { type: "text", text: chat.config.systemPrompt }
      ];
      if (topNode && topNode.role === "system") {
        const newHash = addContent(contentStore, systemContent);
        nodes[topNodeId] = { ...topNode, contentHash: newHash };
      }
    } else {
      if (topNode && topNode.role === "system") {
        const nextId = tree.activePath[1];
        if (nextId && nodes[nextId]) {
          nodes[nextId] = { ...nodes[nextId], parentId: null };
        }
        tree.activePath.splice(0, 1);
        if (!readMessageAttributes(tree)?.byNode[topNodeId])
          delete nodes[topNodeId];
        if (tree.rootId === topNodeId && tree.activePath.length > 0) {
          tree.rootId = tree.activePath[0];
        }
      }
    }
    if (!nodes[tree.rootId]) {
      const newRoot = Object.values(nodes).find((n) => n.parentId === null);
      if (newRoot)
        tree.rootId = newRoot.id;
      else if (tree.activePath.length > 0)
        tree.rootId = tree.activePath[0];
    }
    if (tree.activePath.length > 0) {
      chat.messages = materializeActivePath(tree, contentStore);
    } else {
      chat.messages = [];
    }
  }

  // src/utils/fileImport.ts
  var cloneState = (value) => JSON.parse(JSON.stringify(value));
  var deepClone = (value) => typeof structuredClone === "function" ? structuredClone(value) : cloneState(value);
  var isRecord2 = (value) => typeof value === "object" && value !== null;
  var createImportPlan = (base, mode, includeSettings, initial) => ({
    // JSON-only hosts must retain explicit undefined roots until the final persisted diff.
    ...Object.fromEntries(Object.keys(mode === "replace" && includeSettings ? initial : base).map((key) => [key, void 0])),
    ...deepClone(mode === "replace" && includeSettings ? initial : base),
    chats: mode === "replace" ? [] : deepClone(base.chats),
    folders: mode === "replace" ? {} : deepClone(base.folders),
    contentStore: mode === "replace" ? {} : deepClone(base.contentStore),
    branchClipboard: mode === "replace" ? null : deepClone(base.branchClipboard),
    evaluationResults: mode === "replace" ? {} : deepClone(base.evaluationResults)
  });
  var mergeChats = (plan, chatsToImport) => {
    const chatIdMap = {};
    chatsToImport.forEach((chat) => {
      const prevId = chat.id;
      assignFreshChatIds([chat]);
      chatIdMap[prevId] = chat.id;
    });
    const contentStore = plan.contentStore ?? {};
    for (const chat of chatsToImport) {
      captureProjectedMessageAttributes(chat, contentStore);
      normalizeSystemPrompt(chat, contentStore);
    }
    const existingChats = plan.chats;
    if (existingChats) {
      plan.chats = chatsToImport.concat(existingChats);
    } else {
      plan.chats = chatsToImport;
    }
    return chatIdMap;
  };
  var remapEvaluationResultKeys = (results, chatIdMap) => {
    if (!results)
      return {};
    return Object.fromEntries(
      Object.entries(results).map(([key, value]) => {
        const firstSep = key.indexOf(":");
        const secondSep = key.indexOf(":", firstSep + 1);
        if (firstSep < 0 || secondSep < 0)
          return [key, value];
        const chatId = key.slice(0, firstSep);
        const nextChatId = chatIdMap[chatId] ?? chatId;
        return [`${nextChatId}${key.slice(firstSep)}`, value];
      })
    );
  };
  var clearMissingFolderReferences = (chats, folders) => {
    if (!chats)
      return;
    chats.forEach((chat) => {
      if (chat.folder && !Object.hasOwn(folders, chat.folder)) {
        delete chat.folder;
      }
    });
  };
  var shiftAndMergeFolders = (plan, folders) => {
    const offset = Object.keys(folders).length;
    const currentFolders = plan.folders;
    Object.values(currentFolders).forEach((folder) => {
      folder.order += offset;
    });
    plan.folders = { ...folders, ...currentFolders };
  };
  var decodeLegacyRemoteImport = (raw) => {
    if (!Number.isInteger(raw.version) || raw.version < 0 || raw.version >= STORE_VERSION) {
      throw new Error("\u3053\u306E\u540C\u671F\u30C7\u30FC\u30BF\u306E\u7248\u306F\u53D6\u308A\u8FBC\u3081\u307E\u305B\u3093\u3002\u5BFE\u5FDC\u3059\u308B\u7248\u3067\u958B\u3044\u3066\u304F\u3060\u3055\u3044\u3002");
    }
    if (!isRecord2(raw.state) || !Array.isArray(raw.state.chats)) {
      throw new Error("Invalid legacy remote snapshot");
    }
    const state = deepClone(raw.state);
    const chats = state.chats;
    const hasInlineNodes = chats.some((chat) => chat.branchTree && Object.values(chat.branchTree.nodes).some((node) => "content" in node && !node.contentHash));
    const version = hasInlineNodes ? 2 : isRecord2(state.contentStore) ? 3 : 1;
    if (version === 3 || hasInlineNodes) {
      const hashedChats = hasInlineNodes ? chats.map((chat) => chat.branchTree ? {
        ...chat,
        branchTree: { ...chat.branchTree, nodes: Object.fromEntries(
          Object.entries(chat.branchTree.nodes).filter(([, node]) => node.contentHash !== void 0)
        ) }
      } : chat) : chats;
      const errors = findPersistedDataIntegrityErrors(hashedChats, state.contentStore ?? {}, null);
      if (errors.length)
        throw new Error(`Invalid legacy remote snapshot: ${errors.join("; ")}`);
    }
    for (const chat of chats) {
      if (hasInlineNodes && chat.branchTree) {
        for (const node of Object.values(chat.branchTree.nodes)) {
          if (node.contentHash) {
            node.content = resolveContent(state.contentStore, node.contentHash);
            delete node.contentHash;
          }
        }
      }
      if (chat.messages === void 0) {
        if (!chat.branchTree)
          throw new Error("Invalid legacy remote snapshot: missing chat messages");
        chat.messages = version === 3 ? materializeActivePath(chat.branchTree, state.contentStore) : [];
      }
    }
    return { ...state, version, chats, folders: state.folders ?? {} };
  };
  var detectImportType = (parsedData) => {
    if (isRecord2(parsedData) && parsedData.version === 3)
      return "ExportV3";
    if (isRecord2(parsedData) && parsedData.version === 2)
      return "ExportV2";
    if (isRecord2(parsedData) && parsedData.version === 1)
      return "ExportV1";
    if (isOpenAIContent(parsedData))
      return "OpenAIContent";
    if (isLegacyImport(parsedData))
      return "LegacyImport";
    if (isSingleChatImport(parsedData))
      return "SingleChat";
    return "";
  };
  var buildSuccessResult = (message) => ({
    success: true,
    message
  });
  var buildFailureResult = (message) => ({
    success: false,
    message
  });
  var importLegacyChats = (plan, chatsToImport, t2) => {
    if (!validateAndFixChats(chatsToImport)) {
      return buildFailureResult(
        t2("notifications.invalidChatsDataFormat", { ns: "import" })
      );
    }
    const folderNameToIdMap = {};
    const parsedFolders = [];
    chatsToImport.forEach((chat) => {
      const folder = chat.folder;
      if (!folder)
        return;
      if (!parsedFolders.includes(folder)) {
        parsedFolders.push(folder);
        folderNameToIdMap[folder] = editingUUID();
      }
      chat.folder = folderNameToIdMap[folder];
    });
    const newFolders = parsedFolders.reduce((acc, folderName, index) => {
      const id = folderNameToIdMap[folderName];
      const nextFolder = {
        id,
        name: folderName,
        expanded: false,
        order: index
      };
      return { [id]: nextFolder, ...acc };
    }, {});
    shiftAndMergeFolders(plan, newFolders);
    const contentStore = { ...plan.contentStore };
    for (const chat of chatsToImport) {
      if (!chat.branchTree) {
        flatChatToBranchTree(chat, contentStore);
      }
    }
    plan.contentStore = contentStore;
    mergeChats(plan, chatsToImport);
    return chatsToImport.length > 0 ? buildSuccessResult(t2("notifications.successfulImport", { ns: "import" })) : buildFailureResult(t2("notifications.nothingImported", { ns: "import" }));
  };
  var mergeImportedContent = (plan, chats, importedContentStore) => {
    const existingContentStore = new Map(Object.entries(plan.contentStore).map(([hash, entry]) => [hash, { ...entry }]));
    const importedEntries = Object.entries(importedContentStore);
    const reservedHashes = /* @__PURE__ */ new Set([...existingContentStore.keys(), ...Object.keys(importedContentStore)]);
    for (const entry of [...existingContentStore.values(), ...Object.values(importedContentStore)]) {
      if (entry.delta)
        reservedHashes.add(entry.delta.baseHash);
    }
    for (const chat of [...plan.chats ?? [], ...chats]) {
      for (const node of Object.values(chat.branchTree?.nodes ?? {}))
        reservedHashes.add(node.contentHash);
    }
    for (const node of Object.values(plan.branchClipboard?.nodes ?? {}))
      reservedHashes.add(node.contentHash);
    const hashMap = /* @__PURE__ */ new Map();
    const reserveHash = (hash) => {
      let target = hash;
      do {
        target += "_";
      } while (reservedHashes.has(target));
      reservedHashes.add(target);
      hashMap.set(hash, target);
    };
    for (const [hash, entry] of importedEntries) {
      const existing = existingContentStore.get(hash);
      if (existing && JSON.stringify({ ...existing, refCount: 0 }) !== JSON.stringify({ ...entry, refCount: 0 })) {
        reserveHash(hash);
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [hash, entry] of importedEntries) {
        if (entry.delta && hashMap.has(entry.delta.baseHash) && !hashMap.has(hash) && existingContentStore.has(hash)) {
          reserveHash(hash);
          changed = true;
        }
      }
    }
    for (const [hash, entry] of importedEntries) {
      const target = hashMap.get(hash) ?? hash;
      const imported = deepClone(entry);
      if (imported.delta) {
        imported.delta.baseHash = hashMap.get(imported.delta.baseHash) ?? imported.delta.baseHash;
      }
      const existing = existingContentStore.get(target);
      existingContentStore.set(target, existing ? { ...existing, refCount: existing.refCount + imported.refCount } : imported);
    }
    for (const chat of chats) {
      for (const node of Object.values(chat.branchTree?.nodes ?? {})) {
        node.contentHash = hashMap.get(node.contentHash) ?? node.contentHash;
      }
    }
    plan.contentStore = Object.fromEntries(existingContentStore);
  };
  var importExportV3 = (plan, parsedData, t2, mode, includeSettings) => {
    if (!validateExportV3(parsedData)) {
      return buildFailureResult(
        t2("notifications.invalidFormatForVersion", { ns: "import" })
      );
    }
    const chats = parsedData.chats ?? [];
    clearMissingFolderReferences(chats, parsedData.folders);
    shiftAndMergeFolders(plan, parsedData.folders);
    mergeImportedContent(plan, chats, parsedData.contentStore);
    const chatIdMap = mergeChats(plan, chats);
    if (parsedData.evaluationResults) {
      const remapped = remapEvaluationResultKeys(parsedData.evaluationResults, chatIdMap);
      const existingResults = plan.evaluationResults;
      plan.evaluationResults = { ...existingResults, ...remapped };
    }
    if (includeSettings && mode === "replace" && parsedData.evaluationSettings) {
      const currentDefaults = plan.evaluationSettings;
      plan.evaluationSettings = { ...currentDefaults, ...parsedData.evaluationSettings };
    }
    return chats.length > 0 || Object.keys(parsedData.folders).length > 0 ? buildSuccessResult(t2("notifications.successfulImport", { ns: "import" })) : buildFailureResult(t2("notifications.quotaExceeded", { ns: "import" }));
  };
  var importExportV2 = (plan, parsedData, t2) => {
    if (!validateExportV2(parsedData)) {
      return buildFailureResult(
        t2("notifications.invalidFormatForVersion", { ns: "import" })
      );
    }
    clearMissingFolderReferences(parsedData.chats, parsedData.folders);
    shiftAndMergeFolders(plan, parsedData.folders);
    const contentStore = { ...plan.contentStore };
    if (parsedData.chats) {
      for (const chat of parsedData.chats) {
        if (chat.branchTree) {
          for (const node of Object.values(chat.branchTree.nodes)) {
            if (node.content && !node.contentHash) {
              node.contentHash = addContent(contentStore, node.content);
              delete node.content;
            }
          }
        } else {
          flatChatToBranchTree(chat, contentStore);
        }
      }
    }
    plan.contentStore = contentStore;
    if (parsedData.chats) {
      mergeChats(plan, parsedData.chats);
    }
    return parsedData.chats && parsedData.chats.length > 0 || Object.keys(parsedData.folders).length > 0 ? buildSuccessResult(t2("notifications.successfulImport", { ns: "import" })) : buildFailureResult(t2("notifications.quotaExceeded", { ns: "import" }));
  };
  var importExportV1 = (plan, parsedData, t2) => {
    if (!validateExportV1(parsedData)) {
      return buildFailureResult(
        t2("notifications.invalidFormatForVersion", { ns: "import" })
      );
    }
    clearMissingFolderReferences(parsedData.chats, parsedData.folders);
    shiftAndMergeFolders(plan, parsedData.folders);
    if (parsedData.chats) {
      const contentStore = { ...plan.contentStore };
      for (const chat of parsedData.chats) {
        if (!chat.branchTree) {
          flatChatToBranchTree(chat, contentStore);
        }
      }
      plan.contentStore = contentStore;
      mergeChats(plan, parsedData.chats);
    }
    return parsedData.chats && parsedData.chats.length > 0 || Object.keys(parsedData.folders).length > 0 ? buildSuccessResult(t2("notifications.successfulImport", { ns: "import" })) : buildFailureResult(t2("notifications.quotaExceeded", { ns: "import" }));
  };
  var importOpenAIData = (plan, chatsToImport, shouldAllowPartialImport, t2) => {
    const chats = importOpenAIChatExport(chatsToImport, shouldAllowPartialImport);
    const contentStore = { ...plan.contentStore };
    for (const chat of chats) {
      if (!chat.branchTree) {
        flatChatToBranchTree(chat, contentStore);
      }
    }
    plan.contentStore = contentStore;
    mergeChats(plan, chats);
    return chats.length > 0 ? buildSuccessResult(t2("notifications.successfulImport", { ns: "import" })) : buildFailureResult(t2("notifications.quotaExceeded", { ns: "import" }));
  };
  var validateOpenAIMappings = (data) => {
    for (const chat of Array.isArray(data) ? data : [data]) {
      if (!isRecord2(chat) || !Object.hasOwn(chat, "mapping"))
        continue;
      if (!isRecord2(chat.mapping) || Array.isArray(chat.mapping))
        throw new Error("Invalid OpenAI mapping");
      const mapping = chat.mapping;
      const ids = Object.keys(mapping);
      if (!ids.length)
        throw new Error("Empty OpenAI mapping");
      if (chat.current_node !== void 0 && chat.current_node !== null && (typeof chat.current_node !== "string" || !Object.hasOwn(mapping, chat.current_node))) {
        throw new Error("Invalid OpenAI current_node");
      }
      const parents = /* @__PURE__ */ new Map();
      const children = /* @__PURE__ */ new Map();
      for (const id of ids) {
        const node = mapping[id];
        if (!isRecord2(node) || node.id !== id || !Array.isArray(node.children) || node.parent !== null && (typeof node.parent !== "string" || !Object.hasOwn(mapping, node.parent)) || node.children.some((child) => typeof child !== "string" || !Object.hasOwn(mapping, child))) {
          throw new Error("Invalid OpenAI node references");
        }
        if (isRecord2(node.message) && isRecord2(node.message.author) && !["user", "assistant", "system"].includes(String(node.message.author.role))) {
          throw new Error("Unsupported OpenAI message role");
        }
        parents.set(id, node.parent === null ? [] : [node.parent]);
        children.set(id, node.children);
      }
      for (const edges of [parents, children]) {
        const indegrees = new Map(ids.map((id) => [id, 0]));
        for (const targets of edges.values())
          for (const target of targets)
            indegrees.set(target, indegrees.get(target) + 1);
        const queue = ids.filter((id) => indegrees.get(id) === 0);
        for (let index = 0; index < queue.length; index++) {
          for (const target of edges.get(queue[index])) {
            indegrees.set(target, indegrees.get(target) - 1);
            if (indegrees.get(target) === 0)
              queue.push(target);
          }
        }
        if (queue.length !== ids.length)
          throw new Error("Circular OpenAI mapping");
      }
    }
  };
  var importParsedData = (base, parsedData, type, t2, shouldAllowPartialImport, mode, includeSettings = true, initial = base, decisions = {}, resolveDecision) => {
    if (type === "OpenAIContent")
      validateOpenAIMappings(parsedData);
    let chatsToImport = parsedData;
    let removedChatsCount = 0;
    let reduceImport = decisions.reduceImport === true;
    shouldAllowPartialImport ||= decisions.allowPartialImport === true;
    while (true) {
      const plan = createImportPlan(base, mode, includeSettings, initial);
      try {
        const data = deepClone(chatsToImport);
        let result3;
        switch (type) {
          case "OpenAIContent":
            result3 = importOpenAIData(
              plan,
              data,
              shouldAllowPartialImport,
              t2
            );
            break;
          case "SingleChat":
            result3 = importLegacyChats(plan, [data], t2);
            break;
          case "LegacyImport":
            result3 = importLegacyChats(plan, data, t2);
            break;
          case "ExportV3":
            result3 = importExportV3(plan, data, t2, mode, includeSettings);
            break;
          case "ExportV2":
            result3 = importExportV2(plan, data, t2);
            break;
          case "ExportV1":
            result3 = importExportV1(plan, data, t2);
            break;
          default:
            result3 = buildFailureResult(t2("notifications.unrecognisedDataFormat", { ns: "import" }));
        }
        return { result: result3, plan, removedChatsCount };
      } catch (error2) {
        if (error2.name === "QuotaExceededError") {
          const chats = type === "ExportV1" && isRecord2(chatsToImport) ? chatsToImport.chats : chatsToImport;
          if (!Array.isArray(chats) || !chats.length) {
            return { result: buildFailureResult(t2("notifications.quotaExceeded", { ns: "import" })), plan };
          }
          if (reduceImport) {
            chats.pop();
            removedChatsCount++;
            continue;
          }
          if (decisions.reduceImport === void 0 && resolveDecision)
            decisions.reduceImport = resolveDecision({ kind: "reduce-import", message: t2("reduceMessagesFailedImportWarning") });
          if (decisions.reduceImport === void 0)
            return { result: buildFailureResult(t2("reduceMessagesFailedImportWarning")), plan, decision: { kind: "reduce-import", message: t2("reduceMessagesFailedImportWarning") } };
          if (decisions.reduceImport) {
            reduceImport = true;
            continue;
          }
          return { result: buildFailureResult(t2("notifications.quotaExceeded", { ns: "import" })), plan };
        }
        if (error2 instanceof PartialImportError) {
          if (decisions.allowPartialImport === void 0 && resolveDecision)
            decisions.allowPartialImport = resolveDecision({ kind: "partial-import", message: error2.message });
          if (decisions.allowPartialImport === void 0)
            return { result: buildFailureResult(error2.message), plan, decision: { kind: "partial-import", message: error2.message } };
          if (decisions.allowPartialImport) {
            shouldAllowPartialImport = true;
            reduceImport = true;
            continue;
          }
          return { result: buildFailureResult(t2("notifications.nothingImported", { ns: "import" })), plan };
        }
        return { result: buildFailureResult(error2.message), plan };
      }
    }
  };
  var prepareMissingPreviewContent = (chats, store, t2) => {
    const originalHashes = new Set(Object.keys(store));
    const retained = /* @__PURE__ */ new Map();
    const references = [];
    let recovered = 0;
    const asContent = (value) => {
      const content = typeof value === "string" ? [{ type: "text", text: value }] : value;
      return validateExportV3({
        version: 3,
        chats: [],
        folders: {},
        contentStore: { candidate: { content, refCount: 1 } }
      }) ? content : void 0;
    };
    for (const value of chats) {
      if (!isRecord2(value))
        continue;
      delete value.__previewMissingContent;
      const tree = value.branchTree;
      if (!isRecord2(tree) || !isRecord2(tree.nodes))
        continue;
      for (const node of Object.values(tree.nodes)) {
        if (!isRecord2(node) || typeof node.contentHash !== "string" || originalHashes.has(node.contentHash) || isStreamingContentHash(node.contentHash))
          continue;
        const hash = node.contentHash;
        let content = asContent(node.content);
        const path = tree.activePath;
        const messages = value.messages;
        if (!content && Array.isArray(path) && Array.isArray(messages) && path.length === messages.length) {
          const message = messages[path.indexOf(node.id)];
          if (isRecord2(message) && message.role === node.role) {
            const candidate = asContent(message.content);
            if (candidate) {
              const candidateHash = computeContentHash(candidate);
              if (hash === candidateHash || hash.startsWith(candidateHash) && /^_+$/.test(hash.slice(candidateHash.length)))
                content = candidate;
            }
          }
        }
        references.push({ chat: value, node, hash });
        if (content) {
          const previous = retained.get(hash);
          retained.set(hash, previous === void 0 ? content : JSON.stringify(previous) === JSON.stringify(content) ? previous : null);
        }
      }
    }
    for (const { chat, node, hash } of references) {
      let content = retained.get(hash);
      if (content)
        recovered++;
      else {
        const missing = chat.__previewMissingContent ??= [];
        missing.push(hash);
        content = [{ type: "text", text: t2("preview.missingContent", { ns: "import", hash }) }];
      }
      node.contentHash = addContent(store, content);
      delete node.content;
    }
    return recovered;
  };
  var validatePreviewSource = (source) => {
    if (!validateFolders(source.folders))
      throw new Error("Invalid folder hierarchy");
    const errors = findPersistedDataIntegrityErrors(source.chats, source.contentStore, null);
    if (errors.length)
      throw new Error(errors.join("; "));
    for (const [hash, entry] of Object.entries(source.contentStore)) {
      if (isStreamingContentHash(hash) || entry.delta && isStreamingContentHash(entry.delta.baseHash)) {
        throw new Error("Streaming content cannot be previewed");
      }
    }
    if (validateDeltaIntegrity(source.contentStore).size)
      throw new Error("Invalid delta content");
    for (const chat of source.chats) {
      const tree = chat.branchTree;
      if (!tree)
        continue;
      const ids = Object.keys(tree.nodes);
      if (!Array.isArray(tree.activePath) || ids.length && !tree.nodes[tree.rootId]) {
        throw new Error("Invalid branch root or active path");
      }
      const checked = /* @__PURE__ */ new Set();
      for (const id of ids) {
        const node = tree.nodes[id];
        if (!node || node.id !== id || !["user", "assistant", "system"].includes(node.role) || node.parentId !== null && !tree.nodes[node.parentId])
          throw new Error("Invalid branch node");
        const path = /* @__PURE__ */ new Set();
        let current = id;
        while (current !== null && !checked.has(current)) {
          if (path.has(current))
            throw new Error("Circular branch tree");
          path.add(current);
          current = tree.nodes[current].parentId;
        }
        path.forEach((value) => checked.add(value));
        const content = resolveContent(source.contentStore, node.contentHash);
        if (!validateExportV3({
          version: 3,
          chats: [],
          folders: {},
          contentStore: { resolved: { content, refCount: 1 } }
        }))
          throw new Error("Invalid resolved content");
      }
      const activeIds = /* @__PURE__ */ new Set();
      let previous = null;
      for (const id of tree.activePath) {
        if (!tree.nodes[id] || activeIds.has(id) || tree.nodes[id].parentId !== previous) {
          throw new Error("Invalid active path");
        }
        activeIds.add(id);
        previous = id;
      }
    }
  };
  var prepareImportData = (data, base, t2, decisions = {}, resolveDecision, allowEmpty = false) => {
    const raw = deepClone(data);
    const payload = isRecord2(raw) && isRecord2(raw.state) ? raw.state : raw;
    const rawChats = isRecord2(payload) && Array.isArray(payload.chats) ? payload.chats : Array.isArray(payload) ? payload : [payload];
    let recoveredContentCount = 0;
    if (isRecord2(payload) && isRecord2(payload.contentStore)) {
      const contentStore = payload.contentStore;
      if (!validateExportV3({ version: 3, chats: [], folders: {}, contentStore }))
        throw new Error("Invalid content store");
      for (const [hash, entry] of Object.entries(contentStore)) {
        if (isStreamingContentHash(hash) || entry?.delta && isStreamingContentHash(entry.delta.baseHash)) {
          throw new Error("Streaming content cannot be previewed");
        }
      }
      if (validateDeltaIntegrity(contentStore).size)
        throw new Error("Invalid delta content");
      recoveredContentCount = prepareMissingPreviewContent(rawChats, contentStore, t2);
      const hashedChats = rawChats.map((chat) => isRecord2(chat) && isRecord2(chat.branchTree) && isRecord2(chat.branchTree.nodes) ? { ...chat, branchTree: { ...chat.branchTree, nodes: Object.fromEntries(
        Object.entries(chat.branchTree.nodes).filter(([, node]) => isRecord2(node) && node.contentHash !== void 0)
      ) } } : chat);
      const errors = findPersistedDataIntegrityErrors(hashedChats, contentStore, null).filter((error2) => !error2.startsWith("Duplicate chat id:"));
      if (errors.length)
        throw new Error(errors.join("; "));
    }
    for (const chat of rawChats) {
      if (isRecord2(chat) && isRecord2(chat.branchTree) && isRecord2(chat.branchTree.nodes)) {
        for (const node of Object.values(chat.branchTree.nodes)) {
          if (isRecord2(node) && typeof node.contentHash === "string" && isStreamingContentHash(node.contentHash)) {
            throw new Error("Streaming content cannot be previewed");
          }
        }
      }
    }
    const parsed = isRecord2(raw) && Object.hasOwn(raw, "state") && typeof raw.version === "number" ? decodeLegacyRemoteImport(raw) : raw;
    const type = detectImportType(parsed);
    if (!type)
      throw new Error(t2("notifications.unrecognisedDataFormat", { ns: "import" }));
    const { result: result3, plan, decision } = importParsedData(base, parsed, type, t2, false, "replace", false, base, decisions, resolveDecision);
    if (decision)
      return { status: "decision-required", decision, result: result3 };
    const validEmpty = allowEmpty && !plan.chats?.length && !Object.keys(plan.folders).length && (type === "ExportV3" ? validateExportV3(parsed) : type === "ExportV2" ? validateExportV2(parsed) : type === "ExportV1" ? validateExportV1(parsed) : false);
    if (!result3.success && !validEmpty)
      return { status: "failed", result: result3 };
    const source = previewSourceFromPlan(plan);
    if (isRecord2(parsed) && type.startsWith("Export")) {
      source.extensions = Object.fromEntries(Object.entries(parsed).filter(([key]) => !["version", "chats", "folders", "contentStore", "evaluationSettings", "evaluationResults"].includes(key)));
      if ("evaluationSettings" in parsed)
        source.evaluationSettings = deepClone(parsed.evaluationSettings);
    }
    source.recoveredContentCount = recoveredContentCount;
    source.unavailableContent = {};
    for (const chat of source.chats) {
      if (chat.__previewMissingContent?.length)
        source.unavailableContent[chat.id] = chat.__previewMissingContent;
      delete chat.__previewMissingContent;
    }
    validatePreviewSource(source);
    return { status: "ready", source, type };
  };
  var previewSourceFromPlan = (plan) => {
    for (const chat of plan.chats ?? []) {
      if (!chat.branchTree)
        flatChatToBranchTree(chat, plan.contentStore);
    }
    const source = {
      chats: plan.chats ?? [],
      folders: plan.folders,
      contentStore: plan.contentStore,
      evaluationResults: plan.evaluationResults ?? {}
    };
    return source;
  };
  var validateImportSelection = (source, ids, t2, options, completeFileImport = false) => {
    if (!completeFileImport)
      validatePreviewSource(source);
    const selectedIds = new Set(ids);
    const selected = source.chats.filter((chat) => selectedIds.has(chat.id));
    if (selected.some((chat) => source.unavailableContent?.[chat.id]?.length)) {
      throw new Error(t2("preview.cannotImportMissingContent", { ns: "import" }));
    }
    const includedFolderIds = new Set(options.selectedFolderIds);
    if (selected.length !== selectedIds.size || [...includedFolderIds].some((id) => !Object.hasOwn(source.folders, id))) {
      throw new Error(t2("notifications.nothingImported", { ns: "import" }));
    }
    for (const chat of selected)
      if (chat.folder)
        includedFolderIds.add(chat.folder);
    for (const id of includedFolderIds) {
      const parentId = source.folders[id]?.parentId;
      if (parentId)
        includedFolderIds.add(parentId);
    }
    if (!selected.length && !includedFolderIds.size) {
      throw new Error(t2("notifications.nothingImported", { ns: "import" }));
    }
    return { selectedIds, selected, includedFolderIds };
  };
  var buildPreviewAppendPatch = (base, source, ids, t2, options, completeFileImport = false, currentChatId) => {
    const { selectedIds, selected, includedFolderIds } = validateImportSelection(source, ids, t2, options, completeFileImport);
    const rootId = editingUUID();
    const folderIdMap = Object.fromEntries([...includedFolderIds].map((id) => [id, editingUUID()]));
    const folders = { ...base.folders };
    for (const [id, folder] of Object.entries(folders)) {
      if (!folder.parentId)
        folders[id] = { ...folder, order: folder.order + 1 };
    }
    folders[rootId] = {
      id: rootId,
      name: t2("preview.importFolderName", { fileName: options.fileName, ns: "import", defaultValue: "Import: {{fileName}}" }),
      expanded: true,
      order: 0
    };
    for (const id of includedFolderIds) {
      const folder = source.folders[id];
      const nextId = folderIdMap[id];
      folders[nextId] = {
        ...deepClone(folder),
        id: nextId,
        parentId: folder.parentId ? folderIdMap[folder.parentId] : rootId
      };
    }
    const plan = { ...base, contentStore: deepClone(base.contentStore ?? {}) };
    const chatIdMap = {};
    const chats = selected.map((original) => {
      const prepared = completeFileImport ? void 0 : prepareChatForExport(original, source.contentStore);
      const chat = prepared?.chat ?? deepClone(original);
      assignFreshChatIds([chat]);
      chatIdMap[original.id] = chat.id;
      chat.folder = original.folder ? folderIdMap[original.folder] : rootId;
      chat.messages = completeFileImport ? chat.messages.map(({ role, content }) => ({ role, content })) : materializeActivePath(chat.branchTree, source.contentStore);
      if (prepared)
        mergeImportedContent(plan, [chat], prepared.contentStore);
      return chat;
    });
    if (completeFileImport)
      mergeImportedContent(plan, chats, source.contentStore);
    const contentStore = plan.contentStore;
    const evaluationResults = Object.fromEntries(Object.entries(source.evaluationResults).filter(([key]) => selectedIds.has(key.slice(0, key.indexOf(":")))));
    const selectedChatId = currentChatId;
    const mergedChats = [...chats, ...base.chats ?? []];
    return {
      chats: mergedChats,
      folders,
      contentStore,
      evaluationResults: { ...base.evaluationResults, ...remapEvaluationResultKeys(evaluationResults, chatIdMap) },
      currentChatIndex: selectedChatId ? mergedChats.findIndex((chat) => chat.id === selectedChatId) : mergedChats.length ? 0 : -1
    };
  };

  // src/utils/fileImportProjection.ts
  function importOpaquePaths(data) {
    const paths = [];
    const object2 = (v) => v && typeof v === "object" && !Array.isArray(v);
    const fields = (v, p, known) => {
      if (object2(v)) {
        for (const key of Object.keys(v))
          if (!known.includes(key))
            paths.push([...p, key]);
      }
    };
    const parts = (v, p) => {
      if (!Array.isArray(v))
        return;
      v.forEach((part, index) => {
        const at = [...p, index];
        if (!object2(part))
          return;
        const known = part.type === "text" || part.type === "reasoning" ? ["type", "text"] : part.type === "image_url" ? ["type", "image_url"] : part.type === "tool_call" ? ["type", "id", "name", "arguments"] : part.type === "tool_result" ? ["type", "tool_call_id", "content"] : ["type"];
        fields(part, at, known);
        if (part.type === "image_url")
          fields(part.image_url, [...at, "image_url"], ["url", "detail"]);
      });
    };
    const message = (v, p) => {
      fields(v, p, ["role", "content"]);
      if (object2(v))
        parts(v.content, [...p, "content"]);
    };
    const node = (v, p) => {
      fields(v, p, ["id", "parentId", "role", "contentHash", "content"]);
      if (object2(v))
        parts(v.content, [...p, "content"]);
    };
    const tree = (v, p, extra = []) => {
      fields(v, p, ["nodes", "rootId", "activePath", "messageAttributesV1", ...extra]);
      if (object2(v?.nodes))
        for (const [id, n] of Object.entries(v.nodes))
          node(n, [...p, "nodes", id]);
      if (object2(v?.messageAttributesV1?.byNode))
        for (const [id, attrs] of Object.entries(v.messageAttributesV1.byNode))
          fields(attrs, [...p, "messageAttributesV1", "byNode", id], []);
    };
    const chat = (v, p) => {
      fields(v, p, ["id", "title", "titleSet", "folder", "config", "messages", "branchTree", "collapsedNodes", "omittedNodes", "protectedNodes", "summaryTargets", "summaries"]);
      if (!object2(v))
        return;
      fields(v.config, [...p, "config"], ["model", "systemPrompt", "temperature", "presence_penalty", "top_p", "frequency_penalty"]);
      if (Array.isArray(v.messages))
        v.messages.forEach((m, index) => message(m, [...p, "messages", index]));
      tree(v.branchTree, [...p, "branchTree"]);
      if (Array.isArray(v.summaries))
        v.summaries.forEach((s, index) => {
          const at = [...p, "summaries", index];
          fields(s, at, ["id", "mode", "text", "useForSubmit", "format", "sources", "generation"]);
          if (Array.isArray(s?.sources))
            s.sources.forEach((item, i) => fields(item, [...at, "sources", i], ["nodeId", "parentId", "role", "textParts"]));
          fields(s?.generation, [...at, "generation"], ["model", "providerId", "settings", "createdAt"]);
          if (object2(s?.generation?.settings))
            fields(s.generation.settings, [...at, "generation", "settings"], ["temperature", "max_tokens", "reasoning_effort"]);
        });
    };
    const openAI = (v, p) => {
      fields(v, p, ["title", "mapping", "current_node", "messages", "model", "temperature", "max_tokens", "top_p", "frequency_penalty", "presence_penalty"]);
      if (Array.isArray(v?.messages))
        v.messages.forEach((m, i) => message(m, [...p, "messages", i]));
      if (object2(v?.mapping))
        for (const [id, n] of Object.entries(v.mapping)) {
          const at = [...p, "mapping", id];
          fields(n, at, ["id", "parent", "children", "message"]);
          fields(n?.message, [...at, "message"], ["author", "content"]);
          fields(n?.message?.author, [...at, "message", "author"], ["role"]);
          const content = n?.message?.content;
          if (object2(content) && Object.hasOwn(content, "parts"))
            fields(content, [...at, "message", "content"], ["parts"]);
          else if (object2(content)) {
            const offset = paths.length;
            parts([content], [...at, "message", "content"]);
            for (let i = offset; i < paths.length; i++)
              paths[i].splice(at.length + 2, 1);
          }
        }
    };
    const root = (v, p) => {
      if (Array.isArray(v)) {
        v.forEach((item, index) => isOpenAIContent(item) ? openAI(item, [...p, index]) : chat(item, [...p, index]));
        return;
      }
      if (!object2(v))
        return;
      if (object2(v.state)) {
        fields(v, p, ["version", "state"]);
        root(v.state, [...p, "state"]);
        return;
      }
      if (Array.isArray(v.chats) || object2(v.contentStore) || object2(v.folders)) {
        fields(v, p, ["version", "chats", "folders", "contentStore", "evaluationSettings", "evaluationResults", "recoveredContentCount", "unavailableContent", "extensions", "branchClipboard"]);
        v.chats?.forEach((c, i) => chat(c, [...p, "chats", i]));
        if (object2(v.contentStore))
          for (const [hash, e] of Object.entries(v.contentStore)) {
            fields(e, [...p, "contentStore", hash], ["content", "refCount", "delta"]);
            parts(e?.content, [...p, "contentStore", hash, "content"]);
            fields(e?.delta, [...p, "contentStore", hash, "delta"], ["baseHash", "patch"]);
          }
        if (object2(v.folders))
          for (const [id, f] of Object.entries(v.folders))
            fields(f, [...p, "folders", id], ["id", "name", "order", "expanded", "parentId"]);
        fields(v.evaluationSettings, [...p, "evaluationSettings"], ["safetyPreSend", "safetyPostReceive", "qualityPreSend", "qualityPostReceive"]);
        if (object2(v.evaluationResults))
          for (const [id, r] of Object.entries(v.evaluationResults))
            fields(r, [...p, "evaluationResults", id], ["phase"]);
        if (object2(v.extensions))
          fields(v.extensions, [...p, "extensions"], []);
        const clip = v.branchClipboard;
        if (object2(clip)) {
          fields(clip, [...p, "branchClipboard"], ["nodes", "nodeIds", "sourceChat", "messageAttributesV1", "collapsedNodes", "omittedNodes", "protectedNodes"]);
          tree(clip, [...p, "branchClipboard"], ["nodeIds", "sourceChat", "collapsedNodes", "omittedNodes", "protectedNodes"]);
        }
      } else if (isOpenAIContent(v))
        openAI(v, p);
      else
        chat(v, p);
    };
    root(data, []);
    return paths;
  }

  // shared/google-sync/fileImport.ts
  function importDefaults() {
    const initial = Object.fromEntries(importDefaults_generated_default.keys.map((key) => [key, importDefaults_generated_default.values[key]]));
    return createImportPlan(initial, "replace", false, initial);
  }
  function fileImport(json) {
    const input = JSON.parse(json);
    const t2 = (key, opts) => String(input.messages?.[key] ?? opts?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_23, name) => String(opts?.[name] ?? ""));
    if (input.operation === "defaults")
      return JSON.stringify(importDefaults());
    if (input.operation === "inspect") {
      if (!["data", "state", "source"].includes(input.kind))
        throw new Error("Invalid import projection kind.");
      const data = input.data, contentStorePaths = [];
      if (data && typeof data === "object" && !Array.isArray(data)) {
        if (data.contentStore && typeof data.contentStore === "object")
          contentStorePaths.push(["contentStore"]);
        if (data.state?.contentStore && typeof data.state.contentStore === "object")
          contentStorePaths.push(["state", "contentStore"]);
      }
      return JSON.stringify({ opaquePaths: importOpaquePaths(data), contentStorePaths });
    }
    const run = () => {
      if (input.operation === "preview") {
        const source2 = input.source;
        return { ...source2.extensions, version: 3, chats: source2.chats, folders: source2.folders, contentStore: source2.contentStore, evaluationResults: source2.evaluationResults, ...source2.evaluationSettings ? { evaluationSettings: source2.evaluationSettings } : {} };
      }
      if (input.operation === "prepare") {
        const prepared = prepareImportData(input.data, input.defaults ?? importDefaults(), t2, input.decisions, void 0, input.allowEmpty === true);
        if (prepared.status !== "ready")
          return prepared;
        const source2 = prepared.source;
        return { ...prepared, previewV3: { ...source2.extensions, version: 3, chats: source2.chats, folders: source2.folders, contentStore: source2.contentStore, evaluationResults: source2.evaluationResults, ...source2.evaluationSettings ? { evaluationSettings: source2.evaluationSettings } : {} } };
      }
      if (input.operation !== "plan")
        throw new Error("Invalid import operation.");
      if (input.mode !== "append" && input.mode !== "replace")
        throw new Error("Invalid import mode.");
      const base = input.base, source = input.source;
      validatePreviewSource(source);
      const ids = input.selectedChatIds ?? source.chats.map((chat) => chat.id), folders = input.selectedFolderIds ?? Object.keys(source.folders);
      let data, currentChatIndex;
      if (input.mode === "append") {
        const patch = buildPreviewAppendPatch(base, source, ids, t2, { fileName: input.fileName ?? "", selectedFolderIds: folders }, false, input.currentChatId);
        const { currentChatIndex: index, ...rest } = patch;
        data = { ...base, ...rest };
        currentChatIndex = index;
      } else {
        const resetBase = { ...base, ...createImportPlan(base, "replace", input.includeSettings === true, { ...importDefaults(), ...input.defaults }) };
        const empty = resetBase;
        const options = { fileName: input.fileName ?? "", selectedFolderIds: folders };
        if (ids.length || folders.length)
          validateImportSelection(source, ids, t2, options);
        const complete = ids.length === source.chats.length && folders.length === Object.keys(source.folders).length;
        const selected = complete ? void 0 : buildPreviewAppendPatch(empty, source, ids, t2, options);
        data = complete ? { ...resetBase, chats: structuredClone(source.chats), folders: structuredClone(source.folders), contentStore: structuredClone(source.contentStore), evaluationResults: structuredClone(source.evaluationResults), branchClipboard: null } : { ...resetBase, chats: selected.chats, folders: selected.folders, contentStore: selected.contentStore, evaluationResults: selected.evaluationResults, branchClipboard: null };
        currentChatIndex = ids.length ? 0 : -1;
        if (input.includeSettings && source.evaluationSettings)
          data.evaluationSettings = { ...resetBase.evaluationSettings, ...source.evaluationSettings };
      }
      const persisted = JSON.parse(JSON.stringify(data));
      return {
        result: { success: true, message: t2("notifications.successfulImport", { ns: "import" }) },
        changes: diffJSONChanges(base, persisted),
        currentChatIndex,
        extensionChanges: diffJSONChanges(input.baseExtensions ?? {}, JSON.parse(JSON.stringify({ ...input.baseExtensions, ...source.extensions })))
      };
    };
    const existingIDs = [...input.base?.chats ?? [], ...input.source?.chats ?? []].flatMap((chat) => [chat.id, ...Object.keys(chat.branchTree?.nodes ?? {})]);
    if (input.newIDs !== void 0)
      return JSON.stringify(withEditingRuntime(input.newIDs, existingIDs, input.now ?? Date.now(), run));
    const clock = Date.now;
    if (input.now !== void 0)
      Date.now = () => input.now;
    try {
      return JSON.stringify(run());
    } finally {
      Date.now = clock;
    }
  }

  // src/utils/branchHistory.ts
  var HISTORY_LIMIT = 50;
  var changedBranchChatIds = (previous, next, sameBranch = (a, b) => a.messages === b.messages && a.branchTree === b.branchTree) => {
    const nextById = new Map(next.map((chat) => [chat.id, chat]));
    const previousById = new Map(previous.map((chat) => [chat.id, chat]));
    const ids = /* @__PURE__ */ new Set();
    for (const chat of previous) {
      const updated = nextById.get(chat.id);
      if (!updated || !sameBranch(chat, updated)) {
        ids.add(chat.id);
      }
    }
    for (const chat of next) {
      if (!previousById.has(chat.id))
        ids.add(chat.id);
    }
    return [...ids];
  };
  var snapshotContentStore = (chats, contentStore) => {
    const snapshot = {};
    const add = (hash) => {
      const entry = contentStore[hash];
      if (snapshot[hash] || !entry)
        return;
      snapshot[hash] = structuredClone(entry);
      if (entry.delta)
        add(entry.delta.baseHash);
    };
    for (const chat of chats) {
      Object.values(chat.branchTree?.nodes ?? {}).forEach((node) => add(node.contentHash));
    }
    return snapshot;
  };
  var createBranchSnapshot = (chats, contentStore, chatIds, expectedChats = chats) => {
    const ids = new Set(chatIds);
    const expectedById = new Map(expectedChats.map((chat) => [chat.id, chat]));
    const snapshotChats = chats.filter((chat) => ids.has(chat.id)).map((chat) => ({
      id: chat.id,
      messages: structuredClone(chat.messages),
      branchTree: structuredClone(chat.branchTree),
      expectedActivePath: expectedById.get(chat.id)?.branchTree?.activePath.slice(),
      ...chat.config?.systemPrompt !== expectedById.get(chat.id)?.config?.systemPrompt ? { systemPrompt: { value: chat.config?.systemPrompt } } : {}
    }));
    return {
      chats: snapshotChats,
      contentStore: snapshotContentStore(snapshotChats, contentStore)
    };
  };
  var isUsableActivePath = (tree, path) => path.length > 0 && path.every((id, index) => {
    const node = tree.nodes[id];
    return !!node && (index === 0 ? node.parentId === null : node.parentId === path[index - 1]);
  });
  var pathsEqual = (first, second) => first.length === second.length && first.every((id, index) => id === second[index]);
  var restoreBranchSnapshot = (chats, contentStore, snapshot) => {
    const snapshots = new Map(snapshot.chats.map((chat) => [chat.id, chat]));
    const restored = chats.map((chat) => {
      const saved = snapshots.get(chat.id);
      if (!saved)
        return chat;
      const config = saved.systemPrompt ? { ...chat.config, systemPrompt: saved.systemPrompt.value } : chat.config;
      if (!saved.branchTree)
        return { ...chat, config, messages: structuredClone(saved.messages), branchTree: void 0 };
      const branchTree = structuredClone(saved.branchTree);
      const currentPath = chat.branchTree?.activePath;
      if (currentPath && saved.expectedActivePath && !pathsEqual(currentPath, saved.expectedActivePath) && isUsableActivePath(branchTree, currentPath)) {
        branchTree.activePath = currentPath.slice();
      }
      return { ...chat, config, branchTree, messages: materializeActivePath(branchTree, contentStore) };
    });
    return restored;
  };
  var captureBranchHistory = (history, before, after) => {
    const ids = changedBranchChatIds(before.chats, after.chats);
    return ids.length ? { past: [...history.past, createBranchSnapshot(before.chats, before.contentStore, ids, after.chats)].slice(-HISTORY_LIMIT), future: [] } : history;
  };
  var invalidateBranchHistory = (history, chatIds) => {
    const ids = new Set(chatIds);
    const keep = (snapshot) => !snapshot.chats.some((chat) => ids.has(chat.id));
    return { past: history.past.filter(keep), future: history.future.filter(keep) };
  };
  var canStepBranchHistory = (history, direction, busyChatIds) => {
    const snapshot = (direction === "undo" ? history.past : history.future).at(-1);
    return !!snapshot && !snapshot.chats.some((chat) => busyChatIds.includes(chat.id));
  };
  var stepBranchHistory = (history, state, direction, busyChatIds) => {
    const snapshot = (direction === "undo" ? history.past : history.future).at(-1);
    const affectedChatIds = snapshot?.chats.map((chat) => chat.id) ?? [];
    if (!snapshot)
      return { status: "empty", history, state, affectedChatIds };
    if (affectedChatIds.some((id) => !state.chats.some((chat) => chat.id === id)))
      return { status: "chat-missing", history, state, affectedChatIds };
    if (!canStepBranchHistory(history, direction, busyChatIds))
      return { status: "busy", history, state, affectedChatIds };
    const current = createBranchSnapshot(state.chats, state.contentStore, affectedChatIds, restoreBranchSnapshot(state.chats, state.contentStore, snapshot));
    const contentStore = { ...snapshot.contentStore, ...state.contentStore };
    return {
      status: "updated",
      affectedChatIds,
      state: { chats: restoreBranchSnapshot(state.chats, contentStore, snapshot), contentStore },
      history: direction === "undo" ? { past: history.past.slice(0, -1), future: [...history.future, current] } : { past: [...history.past, current], future: history.future.slice(0, -1) }
    };
  };

  // shared/google-sync/nodeRemoval.ts
  function nodeRemoval(json, capture) {
    const input = JSON.parse(json);
    if (input.operation !== "remove" && input.operation !== "pruneHidden")
      throw new Error("Invalid removal operation.");
    const before = { chat: input.chat, contentStore: input.contentStore };
    let { chat, contentStore } = structuredClone(before);
    if (!Array.isArray(chat.messages) && chat.branchTree)
      chat.messages = materializeActivePath(chat.branchTree, contentStore);
    const wasFlat = !chat.branchTree;
    return withEditingRuntime(input.newIDs, Object.keys(chat.branchTree?.nodes ?? {}), input.now, () => {
      let result3 = { chats: [chat], contentStore };
      if (!wasFlat) {
        result3 = ensureBranchTreeState(result3.chats, 0, result3.contentStore);
        if (input.viewingPath.some((id) => !Object.hasOwn(result3.chats[0].branchTree.nodes, id)))
          throw new Error("Invalid viewing path.");
        result3.chats = switchActivePathState(result3.chats, 0, input.viewingPath, result3.contentStore);
      }
      let historyBase = result3;
      if (input.operation === "remove") {
        if (input.nodeID == null)
          throw new Error("Invalid removal target.");
        const nodeId = wasFlat && input.nodeID.startsWith("message-") ? input.nodeID.slice(8) : input.nodeID;
        const removed = removeNodeState(result3.chats, { chatId: chat.id, nodeId }, result3.contentStore);
        if (removed.status !== "updated")
          throw new Error(`Cannot remove node: ${removed.status}`);
        historyBase = removed.historyBase ?? historyBase;
        result3 = removed;
      } else {
        if (wasFlat)
          return "[]";
        result3 = pruneHiddenNodesState(result3.chats, 0, result3.contentStore);
      }
      for (const [hash, entry] of Object.entries(result3.contentStore)) {
        if (entry.delta && JSON.stringify(entry.delta) !== JSON.stringify(before.contentStore[hash]?.delta)) {
          const content = resolveContent(result3.contentStore, hash);
          const { delta: _delta, ...full } = entry;
          result3.contentStore[hash] = { ...full, content };
        }
      }
      chat = result3.chats[0];
      contentStore = result3.contentStore;
      if (chat.branchTree)
        chat.messages = materializeActivePath(chat.branchTree, contentStore, true);
      capture?.(historyBase, result3);
      return JSON.stringify(diffJSONChanges(before, JSON.parse(JSON.stringify({ chat, contentStore }))));
    });
  }

  // src/utils/nodeOptions.ts
  var updateChatNodeField = (chats, chatIndex, field, value) => {
    const updated = chats.slice();
    updated[chatIndex] = { ...updated[chatIndex], [field]: value };
    return updated;
  };
  var setChatNodeMapState = (chats, input, field) => {
    const index = chats?.findIndex((chat2) => chat2.id === input.chatId) ?? -1;
    const chat = chats?.[index];
    if (!chat)
      return { status: "missing" };
    if (input.nodeId !== void 0 && !(chat.branchTree ? chat.branchTree.nodes[input.nodeId] : String(Number(input.nodeId)) === input.nodeId && Number(input.nodeId) >= 0 && chat.messages[Number(input.nodeId)]))
      return { status: "missing" };
    const previous = chat[field] ?? {};
    const next = input.nodeId !== void 0 ? { ...previous } : {};
    if (input.nodeId !== void 0) {
      if (!!previous[input.nodeId] === input.value)
        return { status: "unchanged" };
      if (input.value)
        next[input.nodeId] = true;
      else
        delete next[input.nodeId];
    } else if (input.value) {
      for (const id of chat.branchTree?.activePath ?? chat.messages.map((_23, index2) => String(index2)))
        next[id] = true;
    }
    if (Object.keys(previous).length === Object.keys(next).length && Object.keys(next).every((id) => previous[id] === next[id]))
      return { status: "unchanged" };
    return { status: "updated", chats: updateChatNodeField(chats, index, field, next), chatIndex: index, map: next };
  };

  // shared/google-sync/nodeOptions.ts
  function nodeOptions(json, capture) {
    const input = JSON.parse(json);
    const target = resolveNodeTarget([input.chat], { chatId: input.chat.id, nodeId: input.nodeId });
    if (target.status !== "valid")
      return JSON.stringify({ status: target.status, changes: [] });
    const node = target.chat.branchTree?.nodes[input.nodeId];
    const value = {
      label: node?.label ?? "",
      starred: !!node?.starred,
      pinned: !!node?.pinned,
      collapsed: !!target.chat.collapsedNodes?.[input.nodeId],
      omitted: !!target.chat.omittedNodes?.[input.nodeId],
      protected: !!target.chat.protectedNodes?.[input.nodeId]
    };
    if (input.operation === "read")
      return JSON.stringify({ status: "read", nodeId: input.nodeId, value });
    if (input.operation !== "save" || !input.value || typeof input.value.label !== "string" || ["starred", "pinned", "collapsed", "omitted", "protected"].some((field) => typeof input.value[field] !== "boolean"))
      throw new Error("Invalid node options.");
    const before = { chat: input.chat, contentStore: input.contentStore };
    let { chat, contentStore } = structuredClone(before), nodeId = input.nodeId;
    return withEditingRuntime(input.newIDs ?? [], Object.keys(chat.branchTree?.nodes ?? {}), input.now ?? Date.now(), () => {
      let historyBase;
      for (const field of ["label", "starred", "pinned"]) {
        if (input.value[field] === value[field])
          continue;
        const next = input.value[field] || void 0;
        const result3 = setNodeDisplayFieldState([chat], { chatId: chat.id, nodeId }, field, next, contentStore);
        if (result3.status === "updated") {
          historyBase ??= result3.historyBase;
          chat = result3.chats[0];
          contentStore = result3.contentStore;
          nodeId = result3.nodeId;
        }
      }
      for (const [field, option] of [["collapsedNodes", "collapsed"], ["omittedNodes", "omitted"], ["protectedNodes", "protected"]]) {
        if (input.value[option] === value[option])
          continue;
        const result3 = setChatNodeMapState([chat], { chatId: chat.id, nodeId, value: input.value[option] }, field);
        if (result3.status === "updated")
          chat = result3.chats[0];
      }
      if (chat.branchTree && !input.chat.branchTree)
        chat.messages = materializeActivePath(chat.branchTree, contentStore, true);
      if (historyBase)
        capture?.(historyBase, { chats: [chat], contentStore });
      const changes = diffJSONChanges(before, JSON.parse(JSON.stringify({ chat, contentStore })));
      return JSON.stringify({ status: changes.length ? "updated" : "unchanged", nodeId, path: chat.branchTree?.activePath, changes });
    });
  }

  // shared/google-sync/treeEdit.ts
  function treeEdit(json, capture) {
    const input = JSON.parse(json);
    const before = { chat: input.chat, contentStore: input.contentStore };
    const isolated = structuredClone(before);
    if (!Array.isArray(isolated.chat.messages) && isolated.chat.branchTree)
      isolated.chat.messages = materializeActivePath(isolated.chat.branchTree, isolated.contentStore);
    const nodeId = !isolated.chat.branchTree && input.nodeID.startsWith("message-") ? input.nodeID.slice(8) : input.nodeID;
    return withEditingRuntime(input.newIDs, Object.keys(isolated.chat.branchTree?.nodes ?? {}), input.now, () => {
      let chats = [isolated.chat];
      if (isolated.chat.branchTree) {
        if (input.viewingPath.some((id) => !Object.hasOwn(isolated.chat.branchTree.nodes, id)))
          throw new Error("Invalid viewing path.");
        chats = switchActivePathState(chats, 0, input.viewingPath, isolated.contentStore);
      }
      const target = { chatId: isolated.chat.id, nodeId };
      let result3;
      switch (input.operation) {
        case "move":
          if (input.direction !== "up" && input.direction !== "down")
            throw new Error("Invalid move direction.");
          result3 = moveNodeState(chats, { ...target, direction: input.direction }, isolated.contentStore);
          break;
        case "replaceAndPrune":
          if (!["user", "assistant", "system"].includes(input.role) || !Array.isArray(input.parts))
            throw new Error("Invalid replacement message.");
          if (input.editedText !== void 0 && typeof input.editedText !== "string")
            throw new Error("Invalid text.");
          const parts = input.editedText !== void 0 && input.editedText !== textValueOf(input.parts) ? replaceTextValue(input.parts, input.editedText) : input.parts;
          result3 = replaceNodeAndPruneState(chats, { ...target, role: input.role, content: parts, removeCount: input.removeCount }, isolated.contentStore);
          break;
        case "deleteBranch":
          result3 = deleteNodeBranchState(chats, target, isolated.contentStore);
          break;
        default:
          throw new Error("Invalid tree operation.");
      }
      if (result3.status !== "updated")
        return JSON.stringify({ ...result3, changes: [] });
      for (const [hash, entry] of Object.entries(result3.contentStore)) {
        if (entry.delta && JSON.stringify(entry.delta) !== JSON.stringify(before.contentStore[hash]?.delta)) {
          const content = resolveContent(result3.contentStore, hash), { delta: _delta, ...full } = entry;
          result3.contentStore[hash] = { ...full, content };
        }
      }
      const chat = result3.chats[0];
      if (chat.branchTree)
        chat.messages = materializeActivePath(chat.branchTree, result3.contentStore, true);
      capture?.(result3.historyBase, result3);
      return JSON.stringify({
        status: result3.status,
        ..."removedNodeIds" in result3 ? { removedNodeIds: result3.removedNodeIds } : {},
        ..."pruneBlockedBy" in result3 ? { pruneBlockedBy: result3.pruneBlockedBy } : {},
        changes: diffJSONChanges(before, JSON.parse(JSON.stringify({ chat, contentStore: result3.contentStore })))
      });
    });
  }

  // src/store/branch-clipboard.ts
  var hasClipboardContent = (clipboard, store) => clipboard.nodeIds.length > 0 && clipboard.nodeIds.every((id) => {
    const node = clipboard.nodes[id];
    if (!node)
      return false;
    const target = getStreamingTargetFromHash(node.contentHash);
    if (target)
      return peekBufferedContent(target.chatId, target.nodeId) !== void 0;
    let hash = node.contentHash;
    const visited = /* @__PURE__ */ new Set();
    while (hash) {
      if (visited.has(hash) || !store[hash])
        return false;
      visited.add(hash);
      hash = store[hash].delta?.baseHash;
    }
    return true;
  });
  var validateSequenceRange = (chats, input) => {
    const from = resolveNodeTarget(chats, { chatId: input.chatId, nodeId: input.fromNodeId });
    const to = resolveNodeTarget(chats, { chatId: input.chatId, nodeId: input.toNodeId });
    if (from.status !== "valid" || to.status !== "valid")
      return { status: "missing" };
    if (!from.chat.branchTree) {
      if (from.messageIndex > to.messageIndex)
        return { status: "not-ancestor" };
      return { status: "valid", chatIndex: from.chatIndex, nodeIds: from.chat.messages.slice(from.messageIndex, to.messageIndex + 1).map((_23, index) => String(from.messageIndex + index)) };
    }
    const clipboard = copyBranchSequenceState(chats, from.chatIndex, input.fromNodeId, input.toNodeId);
    return clipboard ? { status: "valid", chatIndex: from.chatIndex, nodeIds: clipboard.nodeIds } : { status: "not-ancestor" };
  };
  function branchClipboardState(chats, contentStore, clipboard, input) {
    let prepared = { chats, contentStore };
    let sourceIndex = -1, fromIndex = -1, toIndex = -1, rangeIds = [];
    if (input.operation !== "paste") {
      const range = validateSequenceRange(chats, { chatId: input.sourceChatId, fromNodeId: input.fromNodeId, toNodeId: input.toNodeId });
      if (range.status !== "valid")
        return range;
      sourceIndex = range.chatIndex;
      rangeIds = range.nodeIds;
      if (input.operation !== "copy") {
        const blockedNodeIds = rangeIds.filter((id) => chats[sourceIndex].protectedNodes?.[id]);
        if (blockedNodeIds.length)
          return { status: "protected", blockedNodeIds };
      }
      if (!chats[sourceIndex].branchTree) {
        fromIndex = Number(input.fromNodeId);
        toIndex = Number(input.toNodeId);
      }
    }
    const target = input.operation === "paste" || input.operation === "move" ? resolveNodeTarget(chats, { chatId: input.targetChatId, nodeId: input.afterNodeId }) : void 0;
    if (target && target.status !== "valid")
      return { status: "missing" };
    if (input.operation === "move" && target?.status === "valid" && sourceIndex === target.chatIndex && rangeIds.includes(input.afterNodeId))
      return { status: "invalid-target" };
    if (input.operation === "paste") {
      if (!clipboard)
        return { status: "clipboard-empty" };
      if (!hasClipboardContent(clipboard, contentStore))
        return { status: "content-missing" };
    }
    if (sourceIndex >= 0) {
      prepared = ensureBranchTreeState(prepared.chats, sourceIndex, prepared.contentStore);
      const tree = prepared.chats[sourceIndex].branchTree;
      clipboard = copyBranchSequenceState(prepared.chats, sourceIndex, fromIndex >= 0 ? tree.activePath[fromIndex] : input.fromNodeId, toIndex >= 0 ? tree.activePath[toIndex] : input.toNodeId);
      if (input.operation !== "copy" && !hasClipboardContent(clipboard, prepared.contentStore))
        return { status: "content-missing" };
    }
    let afterNodeId = input.afterNodeId;
    if (target?.status === "valid") {
      prepared = ensureBranchTreeState(prepared.chats, target.chatIndex, prepared.contentStore);
      if (!target.chat.branchTree)
        afterNodeId = prepared.chats[target.chatIndex].branchTree.activePath[target.messageIndex];
    }
    const historyBase = prepared;
    if (input.operation === "copy")
      return { status: "copied", ...prepared, clipboard };
    let result3 = prepared;
    if (input.operation === "cut" || input.operation === "move")
      result3 = removeBranchSequenceState(result3.chats, sourceIndex, clipboard.nodeIds, result3.contentStore);
    if (input.operation === "paste" || input.operation === "move")
      result3 = pasteBranchSequenceState(result3.chats, target.chatIndex, afterNodeId, clipboard, result3.contentStore);
    return {
      status: input.operation === "cut" ? "cut" : input.operation === "move" ? "moved" : "pasted",
      ...result3,
      clipboard,
      historyBase,
      ...target?.status === "valid" ? { nodeIds: result3.chats[target.chatIndex].branchTree.activePath.slice(-clipboard.nodeIds.length) } : {}
    };
  }

  // shared/google-sync/branchClipboard.ts
  function branchClipboard(json, capture) {
    const input = JSON.parse(json);
    if (!["copy", "cut", "paste", "move"].includes(input.operation))
      throw new Error("Invalid clipboard operation.");
    const before = { chats: input.chats, contentStore: input.contentStore, clipboard: input.clipboard };
    const isolated = structuredClone(before);
    for (const chat of isolated.chats)
      if (!Array.isArray(chat.messages) && chat.branchTree)
        chat.messages = materializeActivePath(chat.branchTree, isolated.contentStore);
    const result3 = withEditingRuntime(input.newIDs, isolated.chats.flatMap((chat) => Object.keys(chat.branchTree?.nodes ?? {})), input.now, () => branchClipboardState(isolated.chats, isolated.contentStore, isolated.clipboard, input));
    if (!("chats" in result3))
      return JSON.stringify({ ...result3, changes: [] });
    for (const [hash, entry] of Object.entries(result3.contentStore))
      if (entry.delta && JSON.stringify(entry.delta) !== JSON.stringify(before.contentStore[hash]?.delta)) {
        const content = resolveContent(result3.contentStore, hash), { delta: _delta, ...full } = entry;
        result3.contentStore[hash] = { ...full, content };
      }
    const chats = result3.chats.map((chat, index) => chat !== isolated.chats[index] && chat.branchTree ? { ...chat, messages: materializeActivePath(chat.branchTree, result3.contentStore, true) } : before.chats[index]);
    if ("historyBase" in result3)
      capture?.(result3.historyBase, result3);
    const affectedChatIds = chats.filter((chat, index) => !orderedJSONEqual(before.chats[index], chat)).map((chat) => chat.id);
    return JSON.stringify({ status: result3.status, affectedChatIds, ..."nodeIds" in result3 ? { nodeIds: result3.nodeIds } : {}, changes: diffJSONChanges(before, JSON.parse(JSON.stringify({ chats, contentStore: result3.contentStore, clipboard: result3.clipboard }))) });
  }

  // shared/google-sync/branchHistory.ts
  function branchHistory(json) {
    const input = JSON.parse(json);
    let history = input.history ?? { past: [], future: [] };
    const busy = input.busyChatIds ?? [];
    let output2 = {};
    if (input.operation === "edit") {
      const bridges = { messageEdit, nodeRemoval, nodeOptions, treeEdit, branchClipboard };
      const bridge = bridges[input.kind];
      if (!bridge)
        throw new Error("Invalid history edit.");
      const result3 = JSON.parse(bridge(JSON.stringify(input.input), (before, after) => {
        history = captureBranchHistory(history, before, after);
      }));
      output2 = input.kind === "nodeOptions" || input.kind === "treeEdit" || input.kind === "branchClipboard" ? result3 : { changes: result3 };
    } else if (input.operation === "undo" || input.operation === "redo") {
      const before = { chats: input.chats, contentStore: input.contentStore };
      const result3 = stepBranchHistory(history, before, input.operation, busy);
      history = result3.history;
      if (result3.status === "updated") {
        result3.state.chats = result3.state.chats.map((chat) => result3.affectedChatIds.includes(chat.id) && chat.branchTree ? { ...chat, messages: materializeActivePath(chat.branchTree, result3.state.contentStore, true) } : chat);
      }
      output2 = {
        status: result3.status,
        affectedChatIds: result3.affectedChatIds,
        changes: result3.status === "updated" ? diffJSONChanges(before, JSON.parse(JSON.stringify(result3.state))) : []
      };
    } else if (input.operation === "invalidate") {
      const ids = input.chatIds ?? changedBranchChatIds(
        input.before,
        input.after,
        (a, b) => orderedJSONEqual(a.messages, b.messages) && orderedJSONEqual(a.branchTree, b.branchTree)
      );
      history = invalidateBranchHistory(history, ids);
    } else if (input.operation !== "can" && input.operation !== "initialize")
      throw new Error("Invalid history operation.");
    return JSON.stringify({ ...output2, history, can: { undo: canStepBranchHistory(history, "undo", busy), redo: canStepBranchHistory(history, "redo", busy) } });
  }

  // src/utils/branchSearch.ts
  function searchBranchNodes(query, entries, contentStore, scope, options) {
    const hasQuery = query.trim().length > 0;
    const starredOnly = options?.starredOnly ?? false;
    if (!hasQuery && !starredOnly)
      return [];
    const lowerQuery = hasQuery ? query.toLowerCase() : "";
    const results = [];
    const textCache = /* @__PURE__ */ new Map();
    for (const { tree, chatId, chatIndex } of entries) {
      const activePathSet = new Set(tree.activePath);
      const nodeIds = scope === "activePath" ? tree.activePath : dfsOrder(tree);
      for (const nodeId of nodeIds) {
        const node = tree.nodes[nodeId];
        if (!node)
          continue;
        if (starredOnly && !node.starred)
          continue;
        let text = textCache.get(node.contentHash);
        if (text === void 0) {
          text = resolveContentText(contentStore, node.contentHash);
          textCache.set(node.contentHash, text);
        }
        const labelMatch = hasQuery && node.label ? node.label.toLowerCase().includes(lowerQuery) : false;
        const lowerText = text.toLowerCase();
        const contentMatchIdx = hasQuery ? lowerText.indexOf(lowerQuery) : -1;
        const contentMatch = contentMatchIdx >= 0;
        if (hasQuery && !contentMatch && !labelMatch)
          continue;
        let snippet;
        let matchType;
        if (contentMatch) {
          const start2 = Math.max(0, contentMatchIdx - 40);
          const end = Math.min(text.length, contentMatchIdx + query.length + 40);
          snippet = "";
          if (start2 > 0)
            snippet += "...";
          snippet += text.slice(start2, end);
          if (end < text.length)
            snippet += "...";
          matchType = "content";
        } else if (labelMatch) {
          snippet = text.length > 80 ? `${text.slice(0, 80)}...` : text;
          matchType = "label";
        } else {
          snippet = text.length > 80 ? `${text.slice(0, 80)}...` : text;
          matchType = "content";
        }
        results.push({
          nodeId,
          chatId,
          chatIndex,
          snippet,
          isOnActivePath: activePathSet.has(nodeId),
          matchType,
          label: node.label,
          starred: node.starred,
          pinned: node.pinned
        });
      }
    }
    return results;
  }
  function dfsOrder(tree) {
    const result3 = [];
    const childrenMap = /* @__PURE__ */ new Map();
    const hasParentInTree = /* @__PURE__ */ new Set();
    for (const node of Object.values(tree.nodes)) {
      if (node.parentId && tree.nodes[node.parentId]) {
        hasParentInTree.add(node.id);
        const siblings = childrenMap.get(node.parentId);
        if (siblings)
          siblings.push(node.id);
        else
          childrenMap.set(node.parentId, [node.id]);
      }
    }
    const roots = [];
    for (const node of Object.values(tree.nodes)) {
      if (!hasParentInTree.has(node.id)) {
        roots.push(node.id);
      }
    }
    roots.sort((a, b) => a === tree.rootId ? -1 : b === tree.rootId ? 1 : 0);
    const stack = [...roots].reverse();
    while (stack.length > 0) {
      const id = stack.pop();
      result3.push(id);
      const children = childrenMap.get(id);
      if (children) {
        for (let i = children.length - 1; i >= 0; i--) {
          stack.push(children[i]);
        }
      }
    }
    return result3;
  }

  // src/utils/chatSearch.ts
  function matchesChatHistoryFilter(query, chat, folders, currentChatId) {
    const lower = query.toLowerCase();
    const folder = chat.folder ? folders[chat.folder] : void 0;
    const folderName = folder ? getFolderAncestors(folders, folder.id).map((id) => folders[id].name.toLowerCase()).join(" ") : "";
    return chat.title.toLowerCase().includes(lower) || folderName.includes(lower) || chat.id === currentChatId;
  }
  function searchLegacyChat(chat, chatIndex, query) {
    const lowerQuery = query.toLowerCase();
    const results = [];
    for (let i = 0; i < chat.messages.length; i++) {
      const msg = chat.messages[i];
      const textParts2 = msg.content.filter(isTextContent).map((c) => c.text);
      const fullText = textParts2.join(" ");
      const lowerText = fullText.toLowerCase();
      const idx = lowerText.indexOf(lowerQuery);
      if (idx < 0)
        continue;
      const start2 = Math.max(0, idx - 40);
      const end = Math.min(fullText.length, idx + query.length + 40);
      let snippet = "";
      if (start2 > 0)
        snippet += "...";
      snippet += fullText.slice(start2, end);
      if (end < fullText.length)
        snippet += "...";
      results.push({
        nodeId: `legacy-${i}`,
        chatId: chat.id,
        chatIndex,
        snippet,
        isOnActivePath: true,
        matchType: "content"
      });
    }
    return results;
  }
  function grepChats(chats, contentStore, query) {
    const normalized = query.trim();
    if (!normalized)
      return [];
    return chats.flatMap((chat, chatIndex) => {
      const matches = chat.branchTree ? searchBranchNodes(normalized, [{ tree: chat.branchTree, chatId: chat.id, chatIndex }], contentStore, "all") : searchLegacyChat(chat, chatIndex, normalized);
      return matches.length ? [{ chatId: chat.id, chatIndex, chatTitle: chat.title, matches }] : [];
    });
  }

  // shared/google-sync/search.ts
  function resultsJSON(results) {
    return JSON.stringify(results, (key, value) => key === "snippet" && typeof value === "string" ? value.replace(/([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDFFF]/g, (_unit, pair) => pair ?? "\uFFFD") : value);
  }
  function chatSearch(json) {
    const input = JSON.parse(json);
    if (input.currentPath)
      input.chats = input.chats.map((chat) => chat.id === input.currentChatID && chat.branchTree ? { ...chat, branchTree: { ...chat.branchTree, activePath: input.currentPath } } : chat);
    const indexed = input.chats.map((chat, index) => ({ chat, index })).filter(({ chat }) => !input.chatID || chat.id === input.chatID);
    if (input.mode === "library") {
      return resultsJSON(indexed.filter(({ chat }) => matchesChatHistoryFilter(input.query, chat, input.folders, input.currentChatID)).map(({ chat, index }) => ({
        chatId: chat.id,
        nodeId: null,
        resultId: chat.id,
        chatIndex: index,
        chatTitle: chat.title,
        snippet: chat.title,
        matchType: "title",
        isOnActivePath: true
      })));
    }
    if (input.mode === "grep") {
      const groups = grepChats(input.chats, input.contentStore, input.query);
      return resultsJSON(groups.filter((group) => !input.chatID || group.chatId === input.chatID).flatMap((group) => group.matches.map((match) => ({ ...match, resultId: match.nodeId, nodeId: match.nodeId.startsWith("legacy-") && !input.chats[match.chatIndex].branchTree ? null : match.nodeId, chatTitle: group.chatTitle }))));
    }
    if (input.mode !== "nodes")
      throw new Error("Unknown search mode.");
    const entries = indexed.filter(({ chat }) => chat.branchTree).map(({ chat, index }) => ({ tree: chat.branchTree, chatId: chat.id, chatIndex: index }));
    return resultsJSON(searchBranchNodes(input.query, entries, input.contentStore, input.scope ?? "all", { starredOnly: input.starredOnly }).map((match) => ({ ...match, resultId: match.nodeId, chatTitle: input.chats[match.chatIndex].title })));
  }

  // src/utils/branchNavigation.ts
  function resolveNavigationTarget(chats, chatId, nodeId, source = "branch-switch") {
    const chatIndex = chats?.findIndex((chat2) => chat2.id === chatId) ?? -1;
    const chat = chats?.[chatIndex];
    if (!chat)
      return { status: "chat-missing" };
    if (nodeId && !chat.branchTree?.nodes[nodeId])
      return { status: "node-missing" };
    const tree = chat.branchTree;
    const preservePath = (source === "search" || source === "grep") && nodeId && tree?.activePath.includes(nodeId);
    const path = nodeId && tree && !preservePath ? buildPathToLeaf(tree, nodeId) : [...tree?.activePath ?? []];
    return { status: "reached", chatIndex, chatId, path, focusedNodeId: nodeId };
  }
  function navigationEntry(target, viewContext, source) {
    return { chatId: target.chatId, activePath: target.path, focusedNodeId: target.focusedNodeId, viewContext, source };
  }
  function entryWithNavigationKey(entry, key) {
    return { ...entry, key };
  }
  function navigationEntryWithAnchor(entry, anchor) {
    return anchor ? { ...entry, scrollAnchor: { ...anchor } } : entry;
  }
  function captureNavigationHistory(history, entry) {
    return { navHistoryPast: history.navHistoryPast, navHistoryCurrent: entry, navHistoryFuture: history.navHistoryFuture, navEntryMap: history.navEntryMap };
  }
  function restoredNavigationPath(chat, path) {
    const tree = chat.branchTree;
    if (!tree)
      return;
    const valid = path.length > 0 && path.every((id, index) => tree.nodes[id]?.parentId === (index === 0 ? null : path[index - 1]));
    return valid ? [...path] : void 0;
  }
  var emptyNavigationHistory = () => ({ navHistoryPast: [], navHistoryCurrent: null, navHistoryFuture: [], navEntryMap: /* @__PURE__ */ new Map() });
  function initializeNavigationHistory(history, chat, key, viewContext) {
    if (history.navHistoryCurrent || !chat)
      return history;
    const entry = { key, chatId: chat.id, activePath: [...chat.branchTree?.activePath ?? []], viewContext, source: "init" };
    const navEntryMap = new Map(history.navEntryMap);
    navEntryMap.set(key, entry);
    return { navHistoryPast: history.navHistoryPast, navHistoryFuture: history.navHistoryFuture, navHistoryCurrent: entry, navEntryMap };
  }
  function pushNavigationHistory(history, entry) {
    const navHistoryPast = [...history.navHistoryPast];
    if (history.navHistoryCurrent) {
      navHistoryPast.push(history.navHistoryCurrent);
      if (navHistoryPast.length > 100)
        navHistoryPast.shift();
    }
    const navEntryMap = new Map(history.navEntryMap);
    navEntryMap.set(entry.key, entry);
    return { navHistoryPast, navHistoryCurrent: entry, navHistoryFuture: [], navEntryMap };
  }
  function moveNavigationHistory(history, chats, direction) {
    const valid = (entry) => !!chats?.some((chat) => chat.id === entry.chatId);
    const current = history.navHistoryCurrent;
    if (!current)
      return;
    if (direction === "back") {
      const past = history.navHistoryPast, index2 = past.map(valid).lastIndexOf(true);
      if (index2 < 0)
        return;
      return { navEntryMap: history.navEntryMap, navHistoryPast: past.slice(0, index2), navHistoryCurrent: past[index2], navHistoryFuture: [...past.slice(index2 + 1), current, ...history.navHistoryFuture] };
    }
    const future = history.navHistoryFuture, index = future.findIndex(valid);
    if (index < 0)
      return;
    return { navEntryMap: history.navEntryMap, navHistoryPast: [...history.navHistoryPast, current, ...future.slice(0, index)], navHistoryCurrent: future[index], navHistoryFuture: future.slice(index + 1) };
  }
  function canMoveNavigationHistory(history, chats, direction) {
    return (direction === "back" ? history.navHistoryPast : history.navHistoryFuture).some((entry) => chats?.some((chat) => chat.id === entry.chatId));
  }

  // shared/google-sync/navigation.ts
  var decodeHistory = (value) => ({ ...value, navEntryMap: new Map(value.navEntryMap) });
  var encodeHistory = (value) => ({ ...value, navEntryMap: [...value.navEntryMap.entries()] });
  function navigationOperation(json) {
    const input = JSON.parse(json), source = input.source;
    switch (input.operation) {
      case "navigate": {
        let target = resolveNavigationTarget(source.chats, input.chatId, input.nodeId, input.navigationSource);
        if (target.status !== "reached")
          return JSON.stringify({ ...target, changes: [] });
        let chats = source.chats;
        if (input.viewingPath && chats[target.chatIndex].branchTree)
          chats = switchActivePathState(chats, target.chatIndex, input.viewingPath, source.contentStore);
        target = resolveNavigationTarget(chats, input.chatId, input.nodeId, input.navigationSource);
        if (target.status !== "reached")
          return JSON.stringify({ ...target, changes: [] });
        if (chats[target.chatIndex].branchTree)
          chats = switchActivePathState(chats, target.chatIndex, target.path, source.contentStore);
        return JSON.stringify({ ...target, changes: diffJSONChanges(source, JSON.parse(JSON.stringify({ ...source, chats }))) });
      }
      case "restore": {
        const chatIndex = source.chats.findIndex((chat2) => chat2.id === input.entry.chatId), chat = source.chats[chatIndex];
        if (!chat)
          return JSON.stringify({ status: "chat-missing", changes: [] });
        const path = restoredNavigationPath(chat, input.entry.activePath);
        const chats = path ? switchActivePathState(source.chats, chatIndex, path, source.contentStore) : source.chats;
        return JSON.stringify({ status: "reached", chatId: chat.id, chatIndex, path: path ?? [...chat.branchTree?.activePath ?? []], focusedNodeId: input.entry.focusedNodeId, changes: diffJSONChanges(source, JSON.parse(JSON.stringify({ ...source, chats }))) });
      }
      case "candidates":
        return JSON.stringify(source.chats.map((chat) => {
          const grouped = chat.branchTree ? getSiblingGroups(chat.branchTree) : { groups: [], byNode: {} };
          return {
            chatId: chat.id,
            activePath: [...chat.branchTree?.activePath ?? []],
            nodeIDs: Object.keys(chat.branchTree?.nodes ?? {}),
            groups: grouped.groups.map((group) => group.map((node) => node.id)),
            byNode: grouped.byNode
          };
        }));
      case "historyEmpty":
        return JSON.stringify(encodeHistory(emptyNavigationHistory()));
      case "history": {
        const history = decodeHistory(input.history);
        let next = history;
        if (input.action === "initialize") {
          const chat = source.chats.find((chat2) => chat2.id === input.chatId);
          const displayed = chat?.branchTree && input.viewingPath ? { ...chat, branchTree: { ...chat.branchTree, activePath: input.viewingPath } } : chat;
          next = initializeNavigationHistory(history, displayed, input.key, input.view);
        } else if (input.action === "push") {
          const partial = input.target ? navigationEntry(input.target, input.view, input.navigationSource) : input.entry;
          next = pushNavigationHistory(history, entryWithNavigationKey(partial, input.key));
        } else if (input.action === "capture") {
          next = captureNavigationHistory(history, history.navHistoryCurrent && navigationEntryWithAnchor(history.navHistoryCurrent, input.scrollAnchor));
        } else
          next = moveNavigationHistory(history, source.chats, input.action) ?? history;
        return JSON.stringify({ history: encodeHistory(next), entry: next.navHistoryCurrent, canBack: canMoveNavigationHistory(next, source.chats, "back"), canForward: canMoveNavigationHistory(next, source.chats, "forward") });
      }
      default:
        throw new Error("Unknown navigation operation");
    }
  }

  // src/store/storage/google/datasetListing.ts
  var DEFAULT_SYNC_FOLDER_NAME = "Weavelet encrypted sync";
  var defaultSyncFolderName = (id) => `${DEFAULT_SYNC_FOLDER_NAME} (${id})`;
  function nextSyncFolderName(name, names) {
    const base = name.trim();
    const used = new Set(names);
    let candidate = base, suffix = 2;
    while (used.has(candidate))
      candidate = `${base} (${suffix++})`;
    return candidate;
  }
  var DRIVE_LIST_FIELDS = "id,kind,name,mimeType,modifiedTime,size";
  var DRIVE_LIST_QUERY = "trashed = false and (mimeType = 'application/json' or appProperties has { key='weaveletSync' and value='1' } or (mimeType = 'application/octet-stream' and name contains '.json'))";
  function driveListParameters(q = DRIVE_LIST_QUERY, fields = DRIVE_LIST_FIELDS) {
    return { q, orderBy: "modifiedTime desc", pageSize: "1000", fields: `nextPageToken,incompleteSearch,files(${fields})` };
  }

  // src/store/storage/google/datasetHeader.ts
  var SYNC_FOLDER_TYPE = "application/vnd.google-apps.folder";
  function encryptedSyncHeaderId(file) {
    if (file.mimeType !== SYNC_FOLDER_TYPE || file.appProperties?.weaveletSync !== "1" || !file.appProperties.headerId) {
      throw new Error("Legacy sync files are read-only. Create a new encrypted sync folder.");
    }
    return file.appProperties.headerId;
  }

  // src/store/storage/google/settings.ts
  var BROWSER_LOCAL_SETTINGS = [
    "hideMenuOptions",
    "hideSideMenu",
    "menuWidth",
    "splitPanelRatio",
    "splitPanelSwapped",
    "chatActiveView",
    "showDebugPanel",
    "proxyEnabled"
  ];
  var SYNC_LOCAL_SETTINGS = [
    ...BROWSER_LOCAL_SETTINGS,
    "pendingVerifications",
    "verifiedStats",
    "providerModelCache",
    "totalTokenUsed",
    "theme",
    "advancedMode",
    "enterToSubmit",
    "inlineLatex",
    "markdownMode",
    "streamingMarkdownPolicy",
    "displayChatSize",
    "animateBubbleNavigation",
    "branchSwipeDirection"
  ];
  function withoutBrowserLocalSettings(state) {
    const shared2 = { ...state };
    for (const key of SYNC_LOCAL_SETTINGS)
      delete shared2[key];
    return shared2;
  }
  function isBrowserLocalRecord(key) {
    let path;
    try {
      path = JSON.parse(key);
    } catch {
      return false;
    }
    if (!Array.isArray(path) || path[0] !== "state")
      return false;
    const field = path[1];
    return SYNC_LOCAL_SETTINGS.some((key2) => key2 === field);
  }
  function isNonBlockingRecord(key) {
    if (isBrowserLocalRecord(key))
      return true;
    let path;
    try {
      path = JSON.parse(key);
    } catch {
      return false;
    }
    if (!Array.isArray(path))
      return false;
    return path.length === 4 && path[0] === "state" && path[1] === "folders" && path[3] === "expanded" || path.length >= 3 && path.length <= 4 && path[0] === "chats" && path[2] === "collapsedNodes" || path.length === 4 && path[0] === "chats" && path[2] === "branchTree" && path[3] === "activePath";
  }
  function selectActivePath(key, values, records) {
    if (!key.endsWith(',"activePath"]'))
      return;
    const path = JSON.parse(key);
    if (path.length !== 4 || path[0] !== "chats" || path[2] !== "branchTree" || path[3] !== "activePath")
      return;
    if (records[JSON.stringify(["chats", path[1], "id"])] === void 0)
      return null;
    const prefix = ["chats", path[1], "branchTree"];
    const candidates = values.filter((value) => value !== null).map((value) => JSON.parse(value)).filter((value) => Array.isArray(value) && value.every((id) => typeof id === "string"));
    if (!candidates.length)
      return;
    const validPrefix = (ids) => {
      let length = 0;
      for (const id of ids) {
        if (records[JSON.stringify([...prefix, "nodes", id, "id"])] !== JSON.stringify(id) || records[JSON.stringify([...prefix, "nodes", id, "parentId"])] !== JSON.stringify(length ? ids[length - 1] : null))
          break;
        length++;
      }
      return ids.slice(0, length);
    };
    for (const candidate of candidates)
      if (validPrefix(candidate).length === candidate.length)
        return JSON.stringify(candidate);
    const retained = candidates.map(validPrefix).sort((a, b) => b.length - a.length)[0];
    const root = records[JSON.stringify([...prefix, "rootId"])];
    return JSON.stringify(retained.length ? retained : root ? validPrefix([JSON.parse(root)]) : []);
  }

  // shared/google-sync/adapters/host.ts
  function host(operation, ...args) {
    const result3 = JSON.parse(nativeSyncCall(JSON.stringify({ operation, args: args.map((value) => JSON.stringify(value ?? null)) })));
    if (!result3.ok)
      throw new Error(result3.error);
    return result3.value;
  }
  var bytes = (value) => Array.from(value);

  // shared/google-sync/adapters/crypto.ts
  var digest = async (value) => host("digest", typeof value === "string" ? value : bytes(value));
  var encode = (value) => new Uint8Array(host("encode", value));
  var decode = (value) => host("decode", bytes(value));
  var encrypt = async (key, value, context) => new Uint8Array(host("encrypt", key, bytes(value), context));
  var decrypt = async (key, value, context) => new Uint8Array(host("decrypt", key, bytes(value), context));
  var createKeyEnvelope = async (password, dataset) => host("createKeyEnvelope", password, dataset);
  var unlockKey = async (envelope, password, dataset) => host("unlockKey", envelope, password, dataset);

  // shared/google-sync/adapters/metrics.ts
  var recordMetric = () => {
  };

  // shared/google-sync/source/records.ts
  var import_diff_match_patch2 = __toESM(require_diff_match_patch(), 1);
  var SyncConflictError = class extends Error {
    constructor(keys) {
      super("Concurrent edits conflict. Both copies are preserved.");
      this.keys = keys;
    }
  };
  var dmp2 = new import_diff_match_patch2.default();
  var forbidden = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  var readNodeOrder = (value) => {
    if (!Array.isArray(value) || value.some((id) => typeof id !== "string") || new Set(value).size !== value.length) {
      throw new Error("Invalid sync node order.");
    }
    return value;
  };
  var isNodeOrderPath = (path) => Array.isArray(path) && path[0] === "nodeOrder" && (path.length === 3 && path[1] === "chats" && typeof path[2] === "string" || path.length === 2 && path[1] === "clipboard");
  function isNodeOrderRecord(key) {
    try {
      return isNodeOrderPath(JSON.parse(key));
    } catch {
      return false;
    }
  }
  function mergeNodeOrderValues(values) {
    const orders = values.filter((value) => value !== null).map((value) => readNodeOrder(JSON.parse(value)));
    return orders.length ? JSON.stringify([...new Set(orders.flat())]) : null;
  }
  function orderNodes(nodes, value) {
    if (value === void 0)
      return nodes;
    const ids = [.../* @__PURE__ */ new Set([...readNodeOrder(value), ...Object.keys(nodes).sort()])];
    const ordered = /* @__PURE__ */ Object.create(null);
    for (const id of ids)
      if (Object.hasOwn(nodes, id))
        ordered[id] = nodes[id];
    return ordered;
  }
  var contentEntryIdentity = (contentId, metadata) => digest(canonical({ contentId, metadata }));
  var contentEntryRefPath = (chatId, nodeId) => ["contentEntryRefs", "chats", chatId, nodeId];
  var checkSafeMetadata = (value) => {
    if (value && typeof value === "object")
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.has(key))
          throw new Error("Unsafe sync record key.");
        checkSafeMetadata(child);
      }
  };
  function canonical(value) {
    if (Array.isArray(value))
      return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  function resolveStrict(store, hash, visited = /* @__PURE__ */ new Set()) {
    const entry = store[hash];
    if (!entry || visited.has(hash) || visited.size >= 100)
      throw new Error("Missing or cyclic message content; sync stopped.");
    if (!entry.delta)
      return entry.content;
    visited.add(hash);
    const base = resolveStrict(store, entry.delta.baseHash, visited);
    const [text, applied] = dmp2.patch_apply(dmp2.patch_fromText(entry.delta.patches), JSON.stringify(base));
    if (applied.some((ok) => !ok))
      throw new Error("Invalid message delta; sync stopped.");
    return JSON.parse(text);
  }
  async function toRecords(snapshot) {
    const started = performance.now();
    const serialized = JSON.stringify(snapshot);
    const copy2 = JSON.parse(serialized);
    const state = withoutBrowserLocalSettings(copy2.state);
    if (state.folders !== void 0 && !validateFolderHierarchy(state.folders))
      throw new Error("Invalid folder hierarchy; sync stopped.");
    const records = /* @__PURE__ */ Object.create(null);
    const source = state.contentStore ?? {};
    const contentIds = /* @__PURE__ */ new Map();
    const content = /* @__PURE__ */ Object.create(null);
    const assets = /* @__PURE__ */ Object.create(null);
    const entryIds = /* @__PURE__ */ new Map();
    const entries = /* @__PURE__ */ Object.create(null);
    const retained = /* @__PURE__ */ Object.create(null);
    const entryRefs = { chats: /* @__PURE__ */ Object.create(null) };
    const externalize = async (parts) => {
      const encoded = JSON.parse(JSON.stringify(parts));
      for (const part of encoded) {
        if (part.type === "image_url" && typeof part.image_url?.url === "string") {
          const url = part.image_url.url;
          const id = await digest(url);
          assets[id] = url;
          part.image_url.url = { asset: id };
        }
      }
      return encoded;
    };
    for (const [hash, entry] of Object.entries(source)) {
      const parts = await externalize(resolveStrict(source, hash));
      const contentId = await digest(canonical(parts));
      content[contentId] = parts;
      contentIds.set(hash, contentId);
      const { content: _content, refCount: _refCount, delta: _delta, ...metadata } = entry;
      checkSafeMetadata(metadata);
      const record = { contentId, metadata };
      const entryId = await digest(canonical(record));
      entries[entryId] = record;
      entryIds.set(hash, entryId);
      retained[entryId] = true;
    }
    const translate = (node, refs) => {
      const old = node.contentHash;
      if (!contentIds.has(old))
        throw new Error("Missing or cyclic message content; sync stopped.");
      node.contentHash = contentIds.get(old);
      refs[node.id] = entryIds.get(old);
    };
    const chats = /* @__PURE__ */ Object.create(null);
    const order = [];
    const nodeOrder = { chats: /* @__PURE__ */ Object.create(null) };
    for (const chat of state.chats ?? []) {
      if (!chat.id || chats[chat.id])
        throw new Error("Missing or duplicate chat ID; sync stopped.");
      order.push(chat.id);
      if (chat.branchTree) {
        captureProjectedMessageAttributes(chat, source);
        readMessageAttributes(chat.branchTree);
        nodeOrder.chats[chat.id] = Object.keys(chat.branchTree.nodes);
        entryRefs.chats[chat.id] = /* @__PURE__ */ Object.create(null);
        for (const node of Object.values(chat.branchTree.nodes)) {
          const statsKey = `${chat.id}:::${node.id}`;
          const generationId = node.openRouterObservation?.generationId ?? copy2.state.pendingVerifications?.[statsKey]?.generationId ?? copy2.state.verifiedStats?.[statsKey]?.generationId;
          if (generationId)
            node.openRouterObservation = { ...node.openRouterObservation, generationId };
          translate(node, entryRefs.chats[chat.id]);
        }
        delete chat.messages;
      } else if (chat.messages) {
        for (const message of chat.messages)
          message.content = await externalize(message.content);
      }
      chats[chat.id] = chat;
    }
    if (state.branchClipboard) {
      readMessageAttributes(state.branchClipboard);
      const refs = /* @__PURE__ */ Object.create(null);
      entryRefs.clipboard = refs;
      for (const node of Object.values(state.branchClipboard.nodes))
        translate(node, refs);
    }
    if (state.branchClipboard)
      nodeOrder.clipboard = Object.keys(state.branchClipboard.nodes);
    delete state.contentStore;
    delete state.chats;
    const flatten = (value, path) => {
      const messageAttributes = path[0] === "chats" && path[2] === "branchTree" && path[3] === "messageAttributesV1" && path[4] === "byNode" && path.length === 6 || path[0] === "state" && path[1] === "branchClipboard" && path[2] === "messageAttributesV1" && path[3] === "byNode" && path.length === 5;
      if (messageAttributes) {
        checkSafeMetadata(value);
        records[JSON.stringify(path)] = canonical(value);
      } else if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) {
        for (const [key, child] of Object.entries(value)) {
          if (forbidden.has(key))
            throw new Error("Unsafe sync record key.");
          flatten(child, [...path, key]);
        }
      } else
        records[JSON.stringify(path)] = canonical(value);
    };
    flatten({ version: copy2.version ?? 0, state, chats, order, nodeOrder, contentEntryFormat: 1, contentEntryRefs: entryRefs, retainedContentEntries: retained }, []);
    for (const [id, entry] of Object.entries(entries))
      records[JSON.stringify(["contentEntries", id])] = canonical(entry);
    for (const [id, parts] of Object.entries(content))
      records[JSON.stringify(["content", id])] = canonical(parts);
    for (const [id, url] of Object.entries(assets))
      records[JSON.stringify(["assets", id])] = JSON.stringify(url);
    recordMetric("records", started, new TextEncoder().encode(serialized).length, Object.values(records).reduce((n, value) => n + new TextEncoder().encode(value).length, 0));
    return records;
  }
  async function fromRecords(records) {
    const root = /* @__PURE__ */ Object.create(null);
    let skippedLocalState = false;
    const generationIds = /* @__PURE__ */ new Map();
    for (const [encoded, value] of Object.entries(records)) {
      const path = JSON.parse(encoded);
      if (!Array.isArray(path) || path.length < 1 || path.length > 100 || path.some((p) => typeof p !== "string" || forbidden.has(p)))
        throw new Error("Invalid sync record path.");
      if (isBrowserLocalRecord(encoded)) {
        skippedLocalState = true;
        if (path.length === 4 && ["pendingVerifications", "verifiedStats"].includes(path[1]) && path[3] === "generationId") {
          const id = JSON.parse(value);
          if (typeof id === "string" && !generationIds.has(path[2]))
            generationIds.set(path[2], id);
        }
        continue;
      }
      if (path[0] === "chats" && path[2] === "collapsedNodes" && path.length === 3 && value === "{}")
        continue;
      let current = root;
      for (const part of path.slice(0, -1)) {
        if (Object.hasOwn(current, part) && (!current[part] || typeof current[part] !== "object" || Array.isArray(current[part]))) {
          throw new Error("Conflicting sync record paths.");
        }
        current = current[part] ??= /* @__PURE__ */ Object.create(null);
      }
      const last = path[path.length - 1];
      if (Object.hasOwn(current, last))
        throw new Error("Conflicting sync record paths.");
      current[last] = JSON.parse(value);
    }
    if (skippedLocalState && !root.state)
      root.state = /* @__PURE__ */ Object.create(null);
    if (!root.state || !root.chats || !Array.isArray(root.order) || !Number.isInteger(root.version)) {
      throw new Error("Incomplete sync snapshot.");
    }
    if (root.nodeOrder !== void 0) {
      const orders = root.nodeOrder;
      if (!orders || typeof orders !== "object" || Array.isArray(orders) || orders.chats !== void 0 && (!orders.chats || typeof orders.chats !== "object" || Array.isArray(orders.chats))) {
        throw new Error("Invalid sync node order.");
      }
      for (const value of Object.values(orders.chats ?? {}))
        readNodeOrder(value);
      if (orders.clipboard !== void 0)
        readNodeOrder(orders.clipboard);
    }
    if (root.state.folders !== void 0 && !validateFolderHierarchy(root.state.folders))
      throw new Error("Invalid folder hierarchy; sync stopped.");
    const restoreAssets = async (parts) => {
      if (!Array.isArray(parts))
        throw new Error("Invalid message content.");
      const restored = structuredClone(parts);
      for (const part of restored) {
        if (part.type === "image_url" && typeof part.image_url?.url === "object") {
          const id = part.image_url.url?.asset;
          const url = root.assets?.[id];
          if (typeof url !== "string" || await digest(url) !== id)
            throw new Error("Missing or damaged image.");
          part.image_url.url = url;
        }
      }
      return restored;
    };
    const store = {};
    const restoredEntries = /* @__PURE__ */ new Map();
    const extended = root.contentEntryFormat !== void 0;
    if (!extended && ["contentEntries", "contentEntryRefs", "retainedContentEntries"].some((key) => root[key] !== void 0))
      throw new Error("Incomplete content entry extension.");
    if (extended && root.contentEntryFormat !== 1)
      throw new Error("Unsupported content entry format.");
    if (extended) {
      const refs = root.contentEntryRefs;
      if (!refs || typeof refs !== "object" || Array.isArray(refs) || !refs.chats || typeof refs.chats !== "object" || Array.isArray(refs.chats))
        throw new Error("Invalid content entry references.");
      const checkRefs = (values, nodes) => {
        if (!values || typeof values !== "object" || Array.isArray(values))
          throw new Error("Invalid content entry references.");
        for (const [id, entryId] of Object.entries(values))
          if (typeof entryId !== "string" || !nodes?.[id])
            throw new Error("Inconsistent content entry reference.");
      };
      for (const [chatId, values] of Object.entries(refs.chats))
        checkRefs(values, root.chats[chatId]?.branchTree?.nodes);
      if (refs.clipboard !== void 0)
        checkRefs(refs.clipboard, root.state.branchClipboard?.nodes);
    }
    const restoreEntry = async (entryId) => {
      if (typeof entryId !== "string")
        throw new Error("Invalid content entry reference.");
      if (restoredEntries.has(entryId))
        return restoredEntries.get(entryId);
      const entry = root.contentEntries?.[entryId];
      if (!entry || typeof entry.contentId !== "string" || !entry.metadata || typeof entry.metadata !== "object" || Array.isArray(entry.metadata) || ["content", "refCount", "delta"].some((key) => Object.hasOwn(entry.metadata, key)) || await digest(canonical(entry)) !== entryId) {
        throw new Error("Missing or damaged content entry.");
      }
      checkSafeMetadata(entry.metadata);
      const parts = root.content?.[entry.contentId];
      if (!parts || await digest(canonical(parts)) !== entry.contentId)
        throw new Error("Missing or damaged message content.");
      const body = await restoreAssets(parts);
      let hash = computeContentHash(body);
      while (Object.hasOwn(store, hash))
        hash += "_";
      store[hash] = { ...entry.metadata, content: body, refCount: 0 };
      restoredEntries.set(entryId, hash);
      return hash;
    };
    const restore = async (node, refs) => {
      if (extended) {
        const entryId = refs?.[node.id];
        if (!entryId || root.contentEntries?.[entryId]?.contentId !== node.contentHash)
          throw new Error("Inconsistent content entry reference.");
        const hash = await restoreEntry(entryId);
        store[hash].refCount++;
        node.contentHash = hash;
      } else {
        const parts = root.content?.[node.contentHash];
        if (!parts || await digest(canonical(parts)) !== node.contentHash)
          throw new Error("Missing or damaged message content.");
        node.contentHash = addContent(store, await restoreAssets(parts));
      }
    };
    const ids = [.../* @__PURE__ */ new Set([...root.order, ...Object.keys(root.chats).sort()])];
    const chats = [];
    for (const id of ids) {
      const chat = root.chats[id];
      if (!chat)
        continue;
      if (chat.id !== id)
        throw new Error("Invalid chat identity.");
      if (chat.branchTree) {
        const tree = chat.branchTree;
        readMessageAttributes(tree);
        if (!tree.nodes || !Array.isArray(tree.activePath) || typeof tree.rootId !== "string" || tree.rootId && !tree.nodes[tree.rootId]) {
          throw new Error("Incomplete branch tree.");
        }
        tree.nodes = orderNodes(tree.nodes, root.nodeOrder?.chats?.[id]);
        for (const [nodeId, node] of Object.entries(tree.nodes)) {
          if (node.id !== nodeId || node.parentId && !tree.nodes[node.parentId] && node.pinned !== true)
            throw new Error("Orphaned branch node.");
          const seen = /* @__PURE__ */ new Set();
          let cursor = node;
          while (cursor) {
            if (seen.has(cursor.id))
              throw new Error("Cyclic branch tree.");
            seen.add(cursor.id);
            cursor = cursor.parentId ? tree.nodes[cursor.parentId] : void 0;
          }
          await restore(node, root.contentEntryRefs?.chats?.[id]);
          const generationId = node.openRouterObservation?.generationId ?? generationIds.get(`${id}:::${nodeId}`);
          if (generationId)
            node.openRouterObservation = { ...node.openRouterObservation, generationId };
        }
        if (tree.activePath.some((nodeId) => !tree.nodes[nodeId]))
          throw new Error("Invalid active branch path.");
      } else if (chat.messages) {
        for (const message of chat.messages)
          message.content = await restoreAssets(message.content);
      }
      chats.push(chat);
    }
    if (root.state.branchClipboard) {
      readMessageAttributes(root.state.branchClipboard);
      root.state.branchClipboard.nodes = orderNodes(root.state.branchClipboard.nodes, root.nodeOrder?.clipboard);
    }
    for (const node of Object.values(root.state.branchClipboard?.nodes ?? {}))
      await restore(node, root.contentEntryRefs?.clipboard);
    if (extended) {
      if (!root.retainedContentEntries || typeof root.retainedContentEntries !== "object" || Array.isArray(root.retainedContentEntries))
        throw new Error("Invalid retained content entries.");
      for (const [entryId, retained] of Object.entries(root.retainedContentEntries)) {
        if (retained !== true)
          throw new Error("Invalid retained content entry.");
        await restoreEntry(entryId);
      }
    }
    return { version: root.version, state: { ...withoutBrowserLocalSettings(root.state), chats, contentStore: store } };
  }
  async function assertNoConcurrentOrphans(base, local, cloud, merged) {
    const orphans = Object.entries(merged).filter(([key, value]) => {
      const path = JSON.parse(key);
      if (path.length !== 6 || path[0] !== "chats" || path[2] !== "branchTree" || path[3] !== "nodes" || path[5] !== "parentId")
        return false;
      const parent = JSON.parse(value);
      const parentKey = JSON.stringify([...path.slice(0, 4), parent, "id"]);
      return parent && base[parentKey] && !merged[parentKey];
    });
    if (!orphans.length)
      return;
    const affected = new Set(orphans.map(([key]) => JSON.parse(key)[1]));
    for (const source of [local, cloud]) {
      const changed = /* @__PURE__ */ new Map();
      for (const [key, value] of Object.entries(source)) {
        const path = JSON.parse(key);
        const node = path.length === 6 && path[0] === "chats" && path[2] === "branchTree" && (path[3] === "nodes" && path[5] !== "updatedAt" || path[3] === "messageAttributesV1" && path[4] === "byNode") ? [path[1], path[path[3] === "nodes" ? 4 : 5]] : path.length === 4 && path[0] === "contentEntryRefs" && path[1] === "chats" ? [path[2], path[3]] : void 0;
        if (!node || !affected.has(node[0]) || await digest(value) === base[key])
          continue;
        const [chat, id] = node;
        const ids = changed.get(chat) ?? /* @__PURE__ */ new Set();
        changed.set(chat, ids);
        let cursor = id;
        while (cursor && !ids.has(cursor)) {
          ids.add(cursor);
          const parent = source[JSON.stringify(["chats", chat, "branchTree", "nodes", cursor, "parentId"])];
          cursor = parent === void 0 ? null : JSON.parse(parent);
        }
      }
      for (const [key, value] of orphans) {
        const path = JSON.parse(key);
        const parent = JSON.parse(value);
        const parentKey = JSON.stringify([...path.slice(0, 4), parent, "id"]);
        if (source[parentKey] && source[key] === value && changed.get(path[1])?.has(path[4]))
          throw new SyncConflictError([key]);
      }
    }
  }
  async function diffRecords(before, after) {
    const changes = [];
    for (const key of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[key] === after[key])
        continue;
      changes.push({ key, before: before[key] === void 0 ? null : await digest(before[key]), after: after[key] ?? null });
    }
    return changes;
  }
  async function applyChanges(records, changes) {
    const result3 = { ...records };
    const keys = /* @__PURE__ */ new Set();
    for (const change of changes) {
      if (!change || typeof change.key !== "string" || keys.has(change.key) || !(change.before === null || typeof change.before === "string") || !(change.after === null || typeof change.after === "string"))
        throw new Error("Invalid sync change.");
      keys.add(change.key);
      const current = result3[change.key];
      if ((current ?? null) !== change.after && (current === void 0 ? null : await digest(current)) !== change.before) {
        if (isNodeOrderRecord(change.key)) {
          const value = mergeNodeOrderValues([current ?? null, change.after]);
          if (value === null)
            delete result3[change.key];
          else
            result3[change.key] = value;
          continue;
        }
        throw new SyncConflictError([change.key]);
      }
      if (change.after === null)
        delete result3[change.key];
      else
        result3[change.key] = change.after;
    }
    return result3;
  }
  async function hashRecords(records) {
    const hashes = {};
    for (const [key, value] of Object.entries(records))
      hashes[key] = await digest(value);
    return hashes;
  }
  function diffHashedRecords(before, after, hashes) {
    const changes = [];
    for (const key of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[key] === hashes[key])
        continue;
      changes.push({ key, before: before[key] ?? null, after: after[key] ?? null });
    }
    return changes;
  }

  // src/store/storage/google/editTimes.ts
  function mergeEditTimes(key, values) {
    if (key !== '["state","lastContentEditedAt"]' && !key.endsWith(',"updatedAt"]'))
      return;
    const path = JSON.parse(key);
    if (!(path[0] === "state" && path.length === 2 && path[1] === "lastContentEditedAt" || path[0] === "chats" && path.at(-1) === "updatedAt" && (path.length === 3 || path.length === 6 && path[2] === "branchTree" && path[3] === "nodes")))
      return;
    const times = values.map((value) => value == null ? NaN : Number(value));
    if (times.length && times.every((time) => Number.isFinite(time) && time > 0))
      return String(Math.max(...times));
  }

  // shared/google-sync/source/replay.ts
  async function hashCommits(commits) {
    const hashes = {};
    for (const [id, commit] of Object.entries(commits))
      hashes[id] = await digest(encode(commit));
    return hashes;
  }
  async function replayHistory({ commits, tips }) {
    const histories = /* @__PURE__ */ new Map();
    const ancestors = /* @__PURE__ */ new Map();
    const reachable = /* @__PURE__ */ new Set();
    const visit = (id) => {
      if (reachable.has(id))
        return;
      const commit = commits[id];
      if (!commit)
        throw new Error("Missing sync history.");
      reachable.add(id);
      commit.parents.forEach(visit);
    };
    tips.forEach(visit);
    const remaining = new Set([...reachable].sort());
    const latest = (versions) => {
      const excluded = /* @__PURE__ */ new Set();
      const result3 = [];
      for (let index = versions.length - 1; index >= 0; index--) {
        const version = versions[index];
        if (excluded.has(version.id))
          continue;
        result3.push(version);
        for (const ancestor of ancestors.get(version.id))
          excluded.add(ancestor);
      }
      return result3.reverse();
    };
    const valueOf = (versions, key) => {
      if (isNodeOrderRecord(key))
        return mergeNodeOrderValues(versions.map((version) => version.value));
      const time = mergeEditTimes(key, versions.map((version) => version.value));
      if (time !== void 0)
        return time;
      const values = new Set(versions.map((v) => v.value));
      if (values.size > 1 && !isNonBlockingRecord(key))
        throw new SyncConflictError([]);
      return versions[0]?.value ?? null;
    };
    const repairedPath = (key, versions, records2, preceding) => {
      if (!key.endsWith(',"activePath"]'))
        return;
      const values = [...new Set(versions.map((version) => version.value))];
      if (values.length < 2) {
        if (!values[0])
          return;
        const path = JSON.parse(key), ids = JSON.parse(values[0]);
        if (!Array.isArray(ids) || !ids.some((id) => {
          const removed = histories.get(JSON.stringify([...path.slice(0, 3), "nodes", id, "id"]));
          const retained = removed && latest(removed.filter((version) => !preceding || preceding.has(version.id)));
          return retained?.length && retained.every((version) => version.value === null);
        }))
          return;
      }
      return selectActivePath(key, values, records2);
    };
    while (remaining.size) {
      let progress = false;
      for (const id of remaining) {
        const commit = commits[id];
        if (!commit.parents.every((p) => ancestors.has(p)))
          continue;
        const preceding = new Set(commit.parents);
        for (const parent of commit.parents)
          for (const ancestor of ancestors.get(parent))
            preceding.add(ancestor);
        ancestors.set(id, preceding);
        const keys = /* @__PURE__ */ new Set();
        for (const change of commit.changes) {
          if (!change || typeof change.key !== "string" || keys.has(change.key))
            throw new Error("Invalid sync change.");
          keys.add(change.key);
          const history = histories.get(change.key) ?? [];
          const parents = latest(history.filter((v) => preceding.has(v.id)));
          let parentValue;
          if (commit.resolutions?.[change.key]) {
            const expected = [...new Set(await Promise.all(parents.map((v) => v.value === null ? null : digest(v.value))))].sort();
            if (expected.length < 2 || JSON.stringify(expected) !== JSON.stringify([...commit.resolutions[change.key]].sort())) {
              throw new Error("Invalid conflict resolution parents.");
            }
            parentValue = parents[0]?.value ?? null;
          } else if (isNonBlockingRecord(change.key) || isNodeOrderRecord(change.key)) {
            const parentHashes = await Promise.all(parents.map((version) => version.value === null ? null : digest(version.value)));
            const matching = parentHashes.indexOf(change.before);
            parentValue = matching >= 0 ? parents[matching].value : valueOf(parents, change.key);
            if (matching < 0 && change.key.endsWith(',"activePath"]')) {
              const parentRecords = {};
              for (const [key, versions] of histories) {
                const retained = latest(versions.filter((version) => preceding.has(version.id)));
                const value = isNodeOrderRecord(key) ? mergeNodeOrderValues(retained.map((version) => version.value)) : mergeEditTimes(key, retained.map((version) => version.value)) ?? retained[0]?.value ?? null;
                if (value !== null)
                  parentRecords[key] = value;
              }
              const repaired = repairedPath(change.key, parents, parentRecords, preceding);
              if (repaired !== void 0 && (repaired === null ? null : await digest(repaired)) === change.before)
                parentValue = repaired;
            }
          } else
            parentValue = valueOf(parents, change.key);
          const applied = await applyChanges(parentValue === null ? {} : { [change.key]: parentValue }, [change]);
          history.push({ id, value: applied[change.key] ?? null });
          histories.set(change.key, history);
        }
        remaining.delete(id);
        progress = true;
      }
      if (!progress)
        throw new Error("Missing or cyclic sync history.");
    }
    const records = {};
    const conflicts = {};
    for (const [key, history] of histories) {
      const versions = latest(history);
      const values = [...new Set(versions.map((v) => v.value))];
      const time = mergeEditTimes(key, values);
      if (values.length > 1 && time === void 0 && !isNonBlockingRecord(key) && !isNodeOrderRecord(key))
        conflicts[key] = await Promise.all(values.map((v) => v === null ? null : digest(v)));
      const value = isNodeOrderRecord(key) ? valueOf(versions, key) : time ?? versions[0]?.value ?? null;
      if (value !== null)
        records[key] = value;
    }
    for (const [key, history] of histories) {
      const selected = repairedPath(key, latest(history), records);
      if (selected === null)
        delete records[key];
      else if (selected !== void 0)
        records[key] = selected;
    }
    return { records, conflicts };
  }

  // shared/google-sync/source/decodeParts.ts
  function decodeParts(parts) {
    const bytes2 = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) {
      bytes2.set(part, offset);
      offset += part.length;
    }
    return { bytes: bytes2, value: decode(bytes2) };
  }

  // shared/google-sync/adapters/processing.ts
  var encodeAsync = async (value) => encode(value);
  var decodeAsync = async (value) => decode(value);
  var toRecordsAsync = toRecords;
  var fromRecordsAsync = fromRecords;
  var hashRecordsAsync = hashRecords;
  var replayHistoryAsync = replayHistory;
  var decodePartsAsync = async (value) => decodeParts(value);
  var hashCommitsAsync = hashCommits;

  // src/store/storage/google/overview.ts
  function summarizeSyncRecords(snapshot, records) {
    const chats = snapshot.state.chats ?? [];
    return {
      chats: chats.length,
      messages: chats.reduce((count, chat) => count + (chat.branchTree ? Object.keys(chat.branchTree.nodes).length : chat.messages?.length ?? 0), 0),
      bytes: new TextEncoder().encode(JSON.stringify(records)).length
    };
  }
  async function summarizeSyncSnapshot(snapshot) {
    return summarizeSyncRecords(snapshot, await toRecordsAsync(snapshot));
  }

  // shared/google-sync/adapters/diagnostics.ts
  var reportSyncHistory = () => {
  };
  var reportCompaction = () => {
  };
  var recordPackAccess = () => {
  };
  var useGoogleSyncDiagnostics = { getState: () => ({ compaction: { status: "running" } }) };

  // shared/google-sync/source/mergeBranches.ts
  async function mergeBranches(chatId, base, local, cloud) {
    const prefix = ["chats", chatId, "branchTree", "nodes"];
    const baselineFields = /* @__PURE__ */ new Map();
    for (const key of Object.keys(base)) {
      const path = JSON.parse(key);
      if (!prefix.every((p, i) => path[i] === p) || path.length !== 6)
        continue;
      if (!baselineFields.has(path[4]))
        baselineFields.set(path[4], /* @__PURE__ */ new Set());
      baselineFields.get(path[4]).add(path[5]);
    }
    const attributesKey = (id) => JSON.stringify(["chats", chatId, "branchTree", "messageAttributesV1", "byNode", id]);
    const unchanged = async (node, tree2) => {
      const attributes = readMessageAttributes(tree2)?.byNode[node.id];
      if ((attributes === void 0 ? void 0 : await digest(JSON.stringify(attributes))) !== base[attributesKey(node.id)])
        return false;
      const fields = /* @__PURE__ */ new Set([...Object.keys(node), ...baselineFields.get(node.id) ?? []]);
      for (const field of fields) {
        if (field === "updatedAt")
          continue;
        const value = node[field];
        if ((value === void 0 ? void 0 : await digest(JSON.stringify(value))) !== base[JSON.stringify([...prefix, node.id, field])])
          return false;
      }
      return true;
    };
    const sides = [structuredClone(cloud), structuredClone(local)];
    const originals = sides.map((tree2) => structuredClone(tree2));
    for (let side = 0; side < 2; side++) {
      const source = sides[side], other = sides[1 - side];
      const changed = /* @__PURE__ */ new Set();
      for (const node of Object.values(source.nodes))
        if (!await unchanged(node, source)) {
          let cursor = node;
          while (cursor && !changed.has(cursor.id)) {
            changed.add(cursor.id);
            cursor = cursor.parentId ? source.nodes[cursor.parentId] : void 0;
          }
        }
      for (const node of Object.values(source.nodes)) {
        if (!other.nodes[node.id] && !changed.has(node.id)) {
          deleteMessageAttributes(source, node.id);
          delete source.nodes[node.id];
        }
      }
    }
    for (const id of Object.keys(sides[0].nodes)) {
      const right = sides[0].nodes[id], left = sides[1].nodes[id];
      if (!left)
        continue;
      const leftAttributes = readMessageAttributes(sides[1])?.byNode[id], rightAttributes = readMessageAttributes(sides[0])?.byNode[id];
      const lh = leftAttributes === void 0 ? void 0 : await digest(JSON.stringify(leftAttributes));
      const rh = rightAttributes === void 0 ? void 0 : await digest(JSON.stringify(rightAttributes));
      if (lh !== rh && (lh === base[attributesKey(id)] || rh === base[attributesKey(id)])) {
        const attributes = lh === base[attributesKey(id)] ? rightAttributes : leftAttributes;
        for (const side of sides) {
          if (attributes === void 0)
            deleteMessageAttributes(side, id);
          else
            side.messageAttributesV1 = { version: 1, byNode: { ...side.messageAttributesV1?.byNode, [id]: structuredClone(attributes) } };
        }
      }
      for (const field of /* @__PURE__ */ new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (field === "id")
          continue;
        const l = left[field], r = right[field];
        if (l === r)
          continue;
        const time = mergeEditTimes(JSON.stringify([...prefix, id, field]), [l === void 0 ? void 0 : JSON.stringify(l), r === void 0 ? void 0 : JSON.stringify(r)]);
        if (time !== void 0) {
          left.updatedAt = right.updatedAt = Number(time);
          continue;
        }
        const baseline = base[JSON.stringify([...prefix, id, field])];
        const lh2 = l === void 0 ? void 0 : await digest(JSON.stringify(l));
        const rh2 = r === void 0 ? void 0 : await digest(JSON.stringify(r));
        if (lh2 === baseline || rh2 === baseline) {
          const value = lh2 === baseline ? r : l;
          for (const node of [left, right]) {
            if (value === void 0)
              delete node[field];
            else
              node[field] = value;
          }
        }
      }
    }
    const coherent = (tree2) => {
      const checked = /* @__PURE__ */ new Set();
      for (const node of Object.values(tree2.nodes)) {
        const seen = /* @__PURE__ */ new Set();
        let cursor = node;
        while (cursor && !checked.has(cursor.id)) {
          if (seen.has(cursor.id))
            return false;
          seen.add(cursor.id);
          if (cursor.parentId && !tree2.nodes[cursor.parentId])
            return false;
          cursor = cursor.parentId ? tree2.nodes[cursor.parentId] : void 0;
        }
        for (const id of seen)
          checked.add(id);
      }
      return true;
    };
    const inputs = sides.every(coherent) ? sides : originals;
    const nodes = {};
    const byNode = {};
    const maps = [{}, {}];
    const signatures = /* @__PURE__ */ new Map();
    for (let side = 0; side < 2; side++) {
      const tree2 = inputs[side], used = /* @__PURE__ */ new Set();
      const append = (id) => {
        const chain = [];
        let cursor = tree2.nodes[id];
        while (cursor && !maps[side][cursor.id]) {
          chain.push(cursor);
          cursor = cursor.parentId ? tree2.nodes[cursor.parentId] : void 0;
        }
        for (const node of chain.reverse()) {
          const parentId = node.parentId ? maps[side][node.parentId] ?? node.parentId : null;
          const attributes = readMessageAttributes(tree2)?.byNode[node.id];
          const signature = JSON.stringify([parentId, node.role, node.contentHash, node.label ?? null, !!node.starred, !!node.pinned, attributes ?? null]);
          const candidates = side === 1 ? signatures.get(signature)?.filter((candidate) => !used.has(candidate)) : void 0;
          const match = candidates?.includes(node.id) ? node.id : candidates?.[0];
          const target = match ?? (nodes[node.id] ? crypto.randomUUID() : node.id);
          if (!match) {
            nodes[target] = { ...node, id: target, parentId };
            if (attributes)
              byNode[target] = structuredClone(attributes);
            signatures.set(signature, [...signatures.get(signature) ?? [], target]);
          } else if (node.updatedAt !== void 0) {
            nodes[target].updatedAt = Math.max(nodes[target].updatedAt ?? node.updatedAt, node.updatedAt);
          }
          used.add(target);
          maps[side][node.id] = target;
        }
      };
      for (const id of Object.keys(tree2.nodes))
        append(id);
    }
    const activePath = [];
    const visited = /* @__PURE__ */ new Set();
    let tip = local.activePath.map((id) => maps[1][id]).filter(Boolean).at(-1) ?? null;
    while (tip && nodes[tip] && !visited.has(tip)) {
      visited.add(tip);
      activePath.unshift(tip);
      tip = nodes[tip].parentId;
    }
    const tree = { ...Object.keys(byNode).length ? { messageAttributesV1: { version: 1, byNode } } : {}, nodes, activePath, rootId: activePath[0] ?? maps[0][cloud.rootId] ?? Object.keys(nodes)[0] ?? "" };
    return { tree, cloudIds: maps[0], localIds: maps[1] };
  }

  // shared/google-sync/source/merge.ts
  async function mergeSyncRecords(base, local, cloud) {
    const localSnapshot = await fromRecordsAsync(local);
    const cloudSnapshot = await fromRecordsAsync(cloud);
    if (!local[JSON.stringify(["contentEntryFormat"])])
      local = await toRecordsAsync(localSnapshot);
    if (!cloud[JSON.stringify(["contentEntryFormat"])])
      cloud = await toRecordsAsync(cloudSnapshot);
    const merged = { ...cloud };
    const chats = /* @__PURE__ */ new Set();
    const localEdits = /* @__PURE__ */ new Set(), cloudEdits = /* @__PURE__ */ new Set();
    const folders = /* @__PURE__ */ new Map();
    const set = (key, value) => {
      if (value === void 0)
        delete merged[key];
      else
        merged[key] = value;
    };
    for (const key of /* @__PURE__ */ new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(cloud)])) {
      const left = local[key], right = cloud[key];
      const leftHash = left === void 0 ? void 0 : await digest(left);
      const rightHash = right === void 0 ? void 0 : await digest(right);
      const recordPath = JSON.parse(key);
      const editedChat = recordPath[0] === "chats" ? recordPath[1] : recordPath[0] === "contentEntryRefs" && recordPath[1] === "chats" ? recordPath[2] : void 0;
      if (editedChat) {
        if (leftHash !== base[key])
          localEdits.add(editedChat);
        if (rightHash !== base[key])
          cloudEdits.add(editedChat);
      }
      if (left === right || leftHash === base[key])
        continue;
      if (rightHash === base[key]) {
        set(key, left);
        continue;
      }
      const time = mergeEditTimes(key, [left, right]);
      if (time !== void 0) {
        set(key, time);
        continue;
      }
      if (isNonBlockingRecord(key)) {
        set(key, left);
        continue;
      }
      const path = JSON.parse(key);
      if (path[0] === "chats" && path[1]) {
        if (path[2] !== "branchTree")
          chats.add(path[1]);
      } else if (path[0] === "state" && path[1] === "folders" && path[2])
        folders.set(path[2], crypto.randomUUID());
      else if (path[0] === "order") {
        merged[key] = JSON.stringify([.../* @__PURE__ */ new Set([...JSON.parse(right ?? "[]"), ...JSON.parse(left ?? "[]")])]);
      } else if (isNodeOrderPath(path)) {
        const value = mergeNodeOrderValues([right ?? null, left ?? null]);
        if (value === null)
          delete merged[key];
        else
          merged[key] = value;
      } else
        set(key, left);
    }
    for (const id of [...folders.keys()]) {
      for (const descendant of getFolderSubtreeIds(localSnapshot.state.folders ?? {}, id)) {
        if (!folders.has(descendant))
          folders.set(descendant, crypto.randomUUID());
      }
    }
    for (const chat of localSnapshot.state.chats ?? [])
      if (chat.folder && folders.has(chat.folder))
        chats.add(chat.id);
    const copyEntity = (prefix, newId) => {
      for (const key of Object.keys(merged)) {
        const path = JSON.parse(key);
        if (prefix.every((part, i) => path[i] === part))
          delete merged[key];
      }
      for (const [key, value] of Object.entries(cloud)) {
        const path = JSON.parse(key);
        if (prefix.every((part, i) => path[i] === part))
          merged[key] = value;
      }
      if (prefix[0] === "chats") {
        const matches = (path) => path[0] === "contentEntryRefs" && path[1] === "chats" && path[2] === prefix[1];
        for (const key of Object.keys(merged))
          if (matches(JSON.parse(key)))
            delete merged[key];
        for (const [key, value] of Object.entries(cloud))
          if (matches(JSON.parse(key)))
            merged[key] = value;
        if (newId)
          for (const [key, value] of Object.entries(local)) {
            const path = JSON.parse(key);
            if (matches(path)) {
              path[2] = newId;
              merged[JSON.stringify(path)] = value;
            }
          }
        const orderKey = JSON.stringify(["nodeOrder", "chats", prefix[1]]);
        set(orderKey, cloud[orderKey]);
        if (newId)
          set(JSON.stringify(["nodeOrder", "chats", newId]), local[orderKey]);
      }
      if (!newId)
        return;
      for (const [key, value] of Object.entries(local)) {
        const path = JSON.parse(key);
        if (!prefix.every((part, i) => path[i] === part))
          continue;
        path[prefix.length - 1] = newId;
        const field = path[prefix.length];
        merged[JSON.stringify(path)] = field === "id" ? JSON.stringify(newId) : ["folder", "parentId"].includes(field) && folders.has(JSON.parse(value)) ? JSON.stringify(folders.get(JSON.parse(value))) : value;
      }
    };
    for (const [id, newId] of folders)
      copyEntity(["state", "folders", id], localSnapshot.state.folders?.[id] ? newId : void 0);
    for (const id of chats)
      copyEntity(["chats", id], localSnapshot.state.chats?.some((chat) => chat.id === id) ? crypto.randomUUID() : void 0);
    for (const [key, value] of Object.entries({ ...cloud, ...local }))
      if (["assets", "content", "contentEntries"].includes(JSON.parse(key)[0]))
        merged[key] = value;
    for (const [key, value] of Object.entries(merged)) {
      const path = JSON.parse(key);
      if (path[0] !== "contentEntryRefs" || path[1] !== "clipboard" || path.length !== 3)
        continue;
      const bodyKey = JSON.stringify(["state", "branchClipboard", "nodes", path[2], "contentHash"]);
      if (merged[bodyKey] !== void 0) {
        const entry = JSON.parse(merged[JSON.stringify(["contentEntries", JSON.parse(value)])]);
        merged[bodyKey] = JSON.stringify(entry.contentId);
      }
    }
    for (const chat of localSnapshot.state.chats ?? []) {
      const remote = cloudSnapshot.state.chats?.find((item) => item.id === chat.id);
      if (chats.has(chat.id) || !localEdits.has(chat.id) || !cloudEdits.has(chat.id) || !chat.branchTree || !remote?.branchTree)
        continue;
      const branchBase = { ...base };
      const rawTree = async (records, tree2) => {
        const result3 = structuredClone(tree2);
        for (const node of Object.values(result3.nodes)) {
          const bodyKey = JSON.stringify(["chats", chat.id, "branchTree", "nodes", node.id, "contentHash"]);
          const refKey = JSON.stringify(contentEntryRefPath(chat.id, node.id));
          const contentId = JSON.parse(records[bodyKey]);
          node.contentHash = JSON.parse(records[refKey]);
          if (base[refKey])
            branchBase[bodyKey] = base[refKey];
          else if (await digest(records[bodyKey]) === base[bodyKey]) {
            branchBase[bodyKey] = await digest(JSON.stringify(await contentEntryIdentity(contentId, {})));
          }
        }
        return result3;
      };
      const localTree = await rawTree(local, chat.branchTree), cloudTree = await rawTree(cloud, remote.branchTree);
      const { tree, localIds, cloudIds } = await mergeBranches(chat.id, branchBase, localTree, cloudTree);
      for (const key of Object.keys(merged)) {
        const path = JSON.parse(key);
        if (path[0] === "contentEntryRefs" && path[1] === "chats" && path[2] === chat.id)
          delete merged[key];
      }
      for (const node of Object.values(tree.nodes)) {
        const entryId = node.contentHash;
        const entry = JSON.parse(merged[JSON.stringify(["contentEntries", entryId])]);
        merged[JSON.stringify(contentEntryRefPath(chat.id, node.id))] = JSON.stringify(entryId);
        node.contentHash = entry.contentId;
      }
      merged[JSON.stringify(["nodeOrder", "chats", chat.id])] = JSON.stringify(Object.keys(tree.nodes));
      for (const key of Object.keys(merged)) {
        const path = JSON.parse(key);
        if (path[0] === "chats" && path[1] === chat.id && path[2] === "branchTree")
          delete merged[key];
      }
      const put = (path, value) => {
        merged[JSON.stringify(["chats", chat.id, ...path])] = JSON.stringify(value);
      };
      if (tree.messageAttributesV1) {
        put(["branchTree", "messageAttributesV1", "version"], 1);
        for (const [id, attributes] of Object.entries(tree.messageAttributesV1.byNode))
          put(["branchTree", "messageAttributesV1", "byNode", id], attributes);
      }
      put(["branchTree", "rootId"], tree.rootId);
      put(["branchTree", "activePath"], tree.activePath);
      if (!Object.keys(tree.nodes).length)
        put(["branchTree", "nodes"], {});
      for (const node of Object.values(tree.nodes))
        for (const [field, value] of Object.entries(node))
          put(["branchTree", "nodes", node.id, field], value);
      for (const field of ["collapsedNodes", "omittedNodes", "protectedNodes", "summaryTargets"]) {
        for (const [source, ids] of [[remote, cloudIds], [chat, localIds]]) {
          for (const id of Object.keys(source[field] ?? {})) {
            const value = merged[JSON.stringify(["chats", chat.id, field, id])];
            if (ids[id] && ids[id] !== id && value !== void 0)
              put([field, ids[id]], JSON.parse(value));
          }
        }
      }
      const summaryKey = JSON.stringify(["chats", chat.id, "summaries"]);
      const encodedSummaries = merged[summaryKey];
      if (encodedSummaries) {
        const source = encodedSummaries === local[summaryKey] ? chat : remote;
        const ids = source === chat ? localIds : cloudIds;
        try {
          const summaries = JSON.parse(encodedSummaries);
          if (Array.isArray(summaries))
            put(["summaries"], summaries.map((summary) => ({ ...summary, sources: Array.isArray(summary?.sources) ? summary.sources.map((item) => ({ ...item, nodeId: ids[item.nodeId] ?? item.nodeId, parentId: item.parentId === null ? null : ids[item.parentId] ?? item.parentId })) : summary?.sources })));
        } catch {
        }
      }
    }
    for (const key of Object.keys(merged)) {
      const path = JSON.parse(key);
      for (let i = 1; i < path.length; i++) {
        const prefix = JSON.stringify(path.slice(0, i));
        if (merged[prefix] === "{}")
          delete merged[prefix];
      }
    }
    try {
      return await toRecordsAsync(await fromRecordsAsync(merged));
    } catch (error2) {
      const structural = [...localEdits].filter((id) => cloudEdits.has(id) && !chats.has(id));
      if (!structural.length)
        throw error2;
      for (const id of structural)
        copyEntity(["chats", id], localSnapshot.state.chats?.some((chat) => chat.id === id) ? crypto.randomUUID() : void 0);
      return toRecordsAsync(await fromRecordsAsync(merged));
    }
  }

  // shared/google-sync/adapters/progress.ts
  var syncPhase = () => {
  };
  var completedFile = () => {
  };
  var syncStage = async (_start, _count, work) => work();

  // shared/google-sync/adapters/transport.ts
  var SyncFileNotFoundError = class extends Error {
  };

  // shared/google-sync/adapters/cache.ts
  var syncCache = async (dataset) => {
    const value = host("syncCache", dataset);
    return value == null ? void 0 : new Uint8Array(value);
  };
  var readSyncEntries = async (dataset, keys) => host("readSyncEntries", dataset, keys).map((value) => value == null ? void 0 : new Uint8Array(value));
  var writeSyncCache = async (dataset, value, entries = [], remove = []) => host("writeSyncCache", dataset, value ? bytes(value) : null, entries.map(([key, value2]) => [key, bytes(value2)]), remove);
  var rememberedSyncKey = async (dataset, key) => host("rememberedSyncKey", dataset, key ?? null) ?? void 0;

  // src/store/storage/sync/EncryptedSync.ts
  var emptyCache = () => ({ version: 1, commits: {} });
  var PART_BYTES = 1024 * 1024;
  var INLINE_BYTES = 256 * 1024;
  var PACK_BYTES = 4 * 1024 * 1024 - 28;
  var COMPACT_COMMITS = 128;
  var EncryptedSync = class {
    constructor(dataset, transport, options = {}) {
      this.dataset = dataset;
      this.transport = transport;
      this.options = options;
    }
    cache = emptyCache();
    key;
    queue = Promise.resolve();
    closed = false;
    cacheFingerprint;
    remoteConflicts = {};
    remoteCache;
    loading = /* @__PURE__ */ new Set();
    persistedCommits = /* @__PURE__ */ new Set();
    encodedCommits = /* @__PURE__ */ new Map();
    context(id) {
      return `${this.dataset}:${id}`;
    }
    requireKey() {
      if (!this.key || this.closed)
        throw new Error("Unlock encrypted sync with your passphrase first.");
      return this.key;
    }
    close() {
      this.closed = true;
      this.key = void 0;
      this.remoteCache = void 0;
    }
    async parallel(values, work) {
      const results = new Array(values.length);
      let next = 0;
      let failure;
      let failed = false;
      const worker = async () => {
        while (!failed) {
          const index = next++;
          if (index >= values.length)
            return;
          try {
            results[index] = await work(values[index]);
          } catch (error2) {
            failed = true;
            failure = error2;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(this.options.concurrency ?? 2, values.length) }, worker));
      if (failed)
        throw failure;
      return results;
    }
    async save(remove = []) {
      const entries = [];
      const commits = { ...this.cache.commits };
      const pending = this.cache.pending;
      if (pending)
        commits[pending.id] = pending.commit;
      for (const [id, commit] of Object.entries(commits)) {
        if (this.persistedCommits.has(id))
          continue;
        entries.push([`commit:${id}`, await encrypt(this.requireKey(), this.encodedCommits.get(id) ?? await encodeAsync(commit), this.context(`commit:${id}`))]);
      }
      const uploads = [pending, this.cache.compaction].filter((p) => !!p);
      for (const upload of uploads)
        for (const file of upload.files) {
          if (file.bytes)
            entries.push([`outbox:${file.id}`, file.bytes]);
          if (file.sent)
            entries.push([`ack:${file.id}`, await encrypt(this.requireKey(), encode(upload.id), this.context(`ack:${file.id}`))]);
        }
      const stored = {
        version: 2,
        commits: Object.keys(this.cache.commits),
        token: this.cache.token,
        baseline: this.cache.baseline,
        pending: pending && {
          id: pending.id,
          baseline: pending.baseline,
          files: pending.files.map(({ id, kind, size }) => ({ id, kind, size }))
        },
        packs: this.cache.packs,
        parts: this.cache.parts,
        compaction: this.cache.compaction && {
          ...this.cache.compaction,
          files: this.cache.compaction.files.map(({ id, kind, size }) => ({ id, kind, size }))
        }
      };
      const bytes2 = await encrypt(this.requireKey(), await encodeAsync(stored), this.context("cache"));
      await writeSyncCache(this.dataset, bytes2, entries, remove);
      for (const id of Object.keys(commits)) {
        this.persistedCommits.add(id);
        this.encodedCommits.delete(id);
      }
      for (const upload of uploads)
        for (const file of upload.files)
          delete file.bytes;
      this.cacheFingerprint = await digest(bytes2);
      const packs = Object.values(this.cache.packs ?? {});
      const covered = new Set(packs.flatMap((pack) => Object.keys(pack.commits)));
      reportSyncHistory({
        unaggregated: Object.keys(this.cache.commits).filter((id) => !covered.has(id)).length,
        threshold: COMPACT_COMMITS,
        partBytes: PACK_BYTES,
        packs: packs.map((pack) => ({ bytes: pack.bytes, parts: pack.parts.length })),
        cleanupTargets: this.cache.compaction?.remove.length ?? 0
      });
    }
    async loadCache(bytes2) {
      this.remoteCache = void 0;
      const stored = await decodeAsync(await decrypt(this.requireKey(), bytes2, this.context("cache")));
      if (stored.version === 1) {
        this.cache = stored;
        if (stored.baseline)
          this.cache.baseline = await hashRecordsAsync(stored.baseline);
        if (stored.pending) {
          if (stored.pending.baseline)
            stored.pending.baseline = await hashRecordsAsync(stored.pending.baseline);
          for (const file of stored.pending.files) {
            file.bytes = new Uint8Array(file.bytes);
            file.size = file.bytes.length;
          }
        }
        await this.save();
        return;
      }
      if (stored.version !== 2 || !Array.isArray(stored.commits))
        throw new Error("Unsupported local sync cache.");
      const ids = [.../* @__PURE__ */ new Set([...stored.commits, ...stored.pending ? [stored.pending.id] : []])];
      const values = await readSyncEntries(this.dataset, ids.map((id) => `commit:${id}`));
      const commits = {};
      for (let i = 0; i < ids.length; i++) {
        if (!values[i])
          throw new Error("Missing local sync commit.");
        commits[ids[i]] = await decodeAsync(await decrypt(this.requireKey(), values[i], this.context(`commit:${ids[i]}`)));
        this.persistedCommits.add(ids[i]);
      }
      this.cache = {
        version: 1,
        commits: Object.fromEntries(stored.commits.map((id) => [id, commits[id]])),
        token: stored.token,
        baseline: stored.baseline,
        pending: stored.pending && { ...stored.pending, commit: commits[stored.pending.id], files: stored.pending.files.map((f) => ({ ...f, sent: false })) },
        packs: stored.packs,
        parts: stored.parts,
        compaction: stored.compaction && { ...stored.compaction, files: stored.compaction.files.map((f) => ({ ...f, sent: false })) }
      };
    }
    run(work) {
      const task = async () => {
        const guarded = async () => {
          this.requireKey();
          const cached = await syncCache(this.dataset);
          if (cached) {
            const fingerprint = await digest(cached);
            if (this.cacheFingerprint && this.cacheFingerprint !== fingerprint) {
              throw new Error("Another tab changed the sync state. Reload this tab before resuming.");
            }
          }
          try {
            if (cached && !this.cacheFingerprint) {
              this.cacheFingerprint = await digest(cached);
              await this.loadCache(cached);
            }
            return await work();
          } catch (error2) {
            this.cacheFingerprint = void 0;
            this.cache = emptyCache();
            this.remoteCache = void 0;
            this.persistedCommits.clear();
            this.encodedCommits.clear();
            throw error2;
          }
        };
        return typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request(`weavelet-google-sync:${this.dataset}`, guarded) : guarded();
      };
      const result3 = this.queue.then(task);
      this.queue = result3.catch(() => {
      });
      return result3;
    }
    static async create(transport, password, options = {}) {
      const [dataset, header] = await transport.ids(2);
      syncPhase("key");
      const { key, envelope } = await createKeyEnvelope(password, dataset);
      const session2 = new EncryptedSync(dataset, transport, options);
      session2.key = key;
      await session2.save();
      await rememberedSyncKey(dataset, key);
      const headerBytes = new TextEncoder().encode(JSON.stringify(envelope));
      await writeSyncCache(dataset, void 0, [["initial-key", await encrypt(key, headerBytes, session2.context("initial-key"))]]);
      syncPhase("folder");
      const file = await transport.folder(dataset, header, options.folderName);
      await transport.put(header, dataset, "key", headerBytes);
      await writeSyncCache(dataset, void 0, [], ["initial-key"]);
      return { session: session2, file };
    }
    async resumeCreation(header) {
      await this.run(async () => {
        const [saved] = await readSyncEntries(this.dataset, ["initial-key"]);
        if (!saved)
          return;
        const bytes2 = await decrypt(this.requireKey(), saved, this.context("initial-key"));
        await this.transport.folder(this.dataset, header);
        await this.transport.put(header, this.dataset, "key", bytes2);
        await writeSyncCache(this.dataset, void 0, [], ["initial-key"]);
      });
    }
    async unlock(password) {
      const header = await this.transport.keyHeader(this.dataset);
      syncPhase("downloading");
      const envelope = JSON.parse(new TextDecoder().decode(await this.transport.read(header)));
      syncPhase("key");
      this.key = await unlockKey(envelope, password, this.dataset);
      this.closed = false;
      await rememberedSyncKey(this.dataset, this.key);
    }
    async restoreKey() {
      const key = await rememberedSyncKey(this.dataset);
      if (!key)
        return false;
      if (key.type !== "secret" || key.extractable || key.algorithm.name !== "AES-GCM" || key.algorithm.length !== 256 || !key.usages.includes("encrypt") || !key.usages.includes("decrypt")) {
        throw new Error("Invalid remembered sync key.");
      }
      this.key = key;
      this.closed = false;
      return true;
    }
    async downloadManifest(id) {
      const encoded = await decrypt(this.requireKey(), await this.transport.read(id), this.context(id));
      const manifest = await decodeAsync(encoded);
      if (manifest.version !== 2 && (manifest.version !== 1 || !Array.isArray(manifest.parts) || !manifest.parts.length || manifest.parts.some((p) => typeof p !== "string")))
        throw new Error("Invalid sync commit.");
      return manifest;
    }
    async loadCommit(id, manifests) {
      if (this.cache.commits[id])
        return;
      if (this.loading.has(id))
        throw new Error("Cyclic sync history.");
      this.loading.add(id);
      try {
        const packed = Object.entries(this.cache.packs ?? {}).find(([, pack]) => Object.hasOwn(pack.commits, id));
        if (packed) {
          await this.loadPack(packed[1]);
          return;
        }
        const manifest = manifests.get(id) ?? await this.downloadManifest(id);
        if (!manifests.has(id))
          syncPhase("downloading");
        let payload;
        let commit;
        if (manifest.version === 2) {
          commit = { version: 1, parents: manifest.parents, changes: manifest.changes, ...manifest.resolutions ? { resolutions: manifest.resolutions } : {} };
          payload = await encodeAsync(commit);
        } else {
          const chunks = await this.parallel(manifest.parts, async (part) => {
            const bytes2 = await decrypt(this.requireKey(), await this.transport.read(part), this.context(part));
            completedFile(bytes2.length);
            return bytes2;
          });
          const decoded = await decodePartsAsync(chunks);
          payload = decoded.bytes;
          commit = decoded.value;
        }
        if (commit.version !== 1 || !Array.isArray(commit.parents) || !Array.isArray(commit.changes) || commit.parents.some((p) => typeof p !== "string" || p === id))
          throw new Error("Invalid sync commit.");
        this.encodedCommits.set(id, payload);
        (this.cache.parts ??= {})[id] = manifest.parts ?? [];
        for (const parent of commit.parents)
          await this.loadCommit(parent, manifests);
        this.cache.commits[id] = commit;
      } finally {
        this.loading.delete(id);
      }
    }
    async readPackManifest(id) {
      const pack = await decodeAsync(await decrypt(this.requireKey(), await this.transport.read(id, "pack-index"), this.context(id)));
      if (pack.version !== 1 || !pack.commits || typeof pack.commits !== "object" || Array.isArray(pack.commits) || !Object.keys(pack.commits).length || Object.entries(pack.commits).some(([id2, hash]) => !/^[A-Za-z0-9_-]+$/.test(id2) || ["__proto__", "constructor", "prototype"].includes(id2) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) || !Array.isArray(pack.parts) || !pack.parts.length || pack.parts.some((part) => typeof part !== "string" || !part) || new Set(pack.parts).size !== pack.parts.length || !Number.isSafeInteger(pack.bytes) || pack.bytes < 1) {
        throw new Error("Invalid sync pack.");
      }
      return pack;
    }
    async loadPack(pack, verify = false) {
      const missing = Object.keys(pack.commits).some((commit) => !this.cache.commits[commit]);
      const retained = Object.fromEntries(Object.keys(pack.commits).filter((commit) => this.cache.commits[commit]).map((commit) => [commit, this.cache.commits[commit]]));
      for (const [commit, hash] of Object.entries(await hashCommitsAsync(retained))) {
        if (hash !== pack.commits[commit])
          throw new Error("Sync pack history mismatch.");
      }
      if (!missing && !verify) {
        recordPackAccess(true);
        return;
      }
      syncPhase("downloading", pack.parts.length);
      const chunks = await this.parallel(pack.parts, async (part) => {
        const bytes2 = await decrypt(this.requireKey(), await this.transport.read(part, verify ? "verification" : "pack"), this.context(part));
        completedFile(bytes2.length);
        return bytes2;
      });
      const size = chunks.reduce((total, bytes2) => total + bytes2.length, 0);
      if (size !== pack.bytes)
        throw new Error("Incomplete sync pack.");
      const { value: data } = await decodePartsAsync(chunks);
      if (data.version !== 1 || !data.commits || Object.keys(data.commits).length !== Object.keys(pack.commits).length) {
        throw new Error("Invalid sync pack.");
      }
      const encoded = /* @__PURE__ */ new Map();
      for (const [commit] of Object.entries(pack.commits)) {
        const value = data.commits[commit];
        if (!Object.hasOwn(data.commits, commit) || !value || value.version !== 1 || !Array.isArray(value.parents) || value.parents.some((parent) => typeof parent !== "string" || parent === commit) || !Array.isArray(value.changes)) {
          throw new Error("Invalid packed commit.");
        }
        encoded.set(commit, await encodeAsync(value));
      }
      for (const [commit, hash] of Object.entries(pack.commits))
        if (await digest(encoded.get(commit)) !== hash) {
          throw new Error("Sync pack history mismatch.");
        }
      if (!verify)
        recordPackAccess(false);
      if (encoded.size)
        this.remoteCache = void 0;
      for (const [commit, bytes2] of encoded) {
        this.cache.commits[commit] = data.commits[commit];
        if (!this.persistedCommits.has(commit))
          this.encodedCommits.set(commit, bytes2);
      }
    }
    async discoverPacks(ids) {
      ids ??= await this.transport.packs(this.dataset);
      const packs = this.cache.packs ??= {};
      for (const id of Object.keys(packs))
        if (!ids.includes(id))
          delete packs[id];
      for (const id of ids) {
        const pack = packs[id] ?? await this.readPackManifest(id);
        await this.loadPack(pack);
        packs[id] = pack;
      }
    }
    packedCommits() {
      return new Set(Object.values(this.cache.packs ?? {}).flatMap((pack) => Object.keys(pack.commits)));
    }
    async refresh(retry = true) {
      try {
        syncPhase("checking");
        const ids = /* @__PURE__ */ new Set();
        if (!this.cache.token) {
          const token = await this.transport.startToken();
          const history = await this.transport.history(this.dataset);
          await this.discoverPacks(history.packs);
          for (const id of history.commits)
            ids.add(id);
          this.cache.token = token;
        }
        const page = await this.transport.changes(this.cache.token);
        if (page.changes.some((change) => change.removed || change.dataset === this.dataset && (change.kind === "commit" || change.kind === "pack")))
          this.remoteCache = void 0;
        const removed = new Set(page.changes.filter((change) => change.removed).map((change) => change.id));
        if (removed.has(this.dataset))
          throw new Error("Sync folder was deleted from storage; sync stopped.");
        const oldPacks = this.cache.packs ?? {};
        const removedPacks = Object.entries(oldPacks).filter(([id]) => removed.has(id));
        const packChanged = page.changes.some((change) => change.dataset === this.dataset && change.kind === "pack") || removedPacks.length > 0;
        if (packChanged || [...removed].some((id) => this.cache.commits[id] || ids.has(id)))
          await this.discoverPacks();
        const covered = this.packedCommits();
        for (const [, pack] of removedPacks)
          if (Object.keys(pack.commits).some((id) => !covered.has(id))) {
            throw new Error("Sync history was deleted from storage; sync stopped.");
          }
        for (const id of removed) {
          if ((this.cache.commits[id] || ids.has(id)) && !covered.has(id)) {
            throw new Error("Sync history was deleted from storage; sync stopped.");
          }
          ids.delete(id);
        }
        for (const change of page.changes) {
          if (change.dataset === this.dataset && change.kind === "commit" && !removed.has(change.id))
            ids.add(change.id);
        }
        const missing = [...ids].filter((id) => !this.cache.commits[id]);
        if (missing.length) {
          syncPhase("downloading");
          const manifests = /* @__PURE__ */ new Map();
          let partCount = 0;
          const unbundled = missing.filter((id) => !covered.has(id));
          const downloaded = await this.parallel(unbundled, async (id) => [id, await this.downloadManifest(id)]);
          for (const [id, manifest] of downloaded) {
            manifests.set(id, manifest);
            if (manifest.version === 1)
              partCount += manifest.parts.length;
          }
          syncPhase("downloading", missing.length + partCount, void 0, missing.length);
          for (const id of missing)
            await this.loadCommit(id, manifests);
        }
        for (const commit of Object.values(this.cache.commits))
          for (const parent of commit.parents) {
            if (!this.cache.commits[parent])
              await this.loadCommit(parent, /* @__PURE__ */ new Map());
          }
        this.cache.token = page.token;
        await this.save();
      } catch (error2) {
        if (!retry || !(error2 instanceof SyncFileNotFoundError))
          throw error2;
        this.cache.token = void 0;
        await this.discoverPacks();
        await this.refresh(false);
      }
    }
    heads() {
      const parents = new Set(Object.values(this.cache.commits).flatMap((c) => c.parents));
      return Object.keys(this.cache.commits).filter((id) => !parents.has(id)).sort();
    }
    async remote(allowConflicts = false, tips) {
      syncPhase("verifying");
      const cached = tips ? void 0 : this.remoteCache;
      const { records, conflicts } = cached ?? await replayHistoryAsync({ commits: this.cache.commits, tips: tips ?? this.heads() });
      if (!tips)
        this.remoteCache = { records, conflicts };
      this.remoteConflicts = conflicts;
      if (!allowConflicts && Object.keys(conflicts).length)
        throw new SyncConflictError(Object.keys(conflicts));
      return records;
    }
    async sendFiles(pending, publication) {
      const acks = await readSyncEntries(this.dataset, pending.files.map((f) => `ack:${f.id}`));
      for (let i = 0; i < acks.length; i++)
        if (acks[i]) {
          const id = decode(await decrypt(this.requireKey(), acks[i], this.context(`ack:${pending.files[i].id}`)));
          if (id !== pending.id)
            throw new Error("Invalid upload completion record.");
          pending.files[i].sent = true;
        }
      const remaining = pending.files.filter((file) => !file.sent);
      syncPhase("uploading", remaining.length, remaining.reduce((total, file) => total + file.size, 0));
      const send = async (file) => {
        this.requireKey();
        const [bytes2] = await readSyncEntries(this.dataset, [`outbox:${file.id}`]);
        if (!bytes2 || bytes2.length !== file.size)
          throw new Error("Missing local upload data.");
        await decrypt(this.requireKey(), bytes2, this.context(file.id));
        await this.transport.put(file.id, this.dataset, file.kind, bytes2);
        const ack = await encrypt(this.requireKey(), encode(pending.id), this.context(`ack:${file.id}`));
        await writeSyncCache(this.dataset, void 0, [[`ack:${file.id}`, ack]]);
        file.sent = true;
        completedFile(file.size);
      };
      const parts = remaining.filter((file) => file.kind !== publication);
      await this.parallel(parts, send);
      for (const file of remaining.filter((file2) => file2.kind === publication))
        await send(file);
    }
    async sendPending() {
      const pending = this.cache.pending;
      if (!pending)
        return;
      await this.sendFiles(pending, "commit");
      syncPhase("saving");
      (this.cache.parts ??= {})[pending.id] = pending.files.filter((file) => file.kind === "part").map((file) => file.id);
      this.cache.commits[pending.id] = pending.commit;
      this.remoteCache = void 0;
      if (pending.baseline)
        this.cache.baseline = pending.baseline;
      delete this.cache.pending;
      await this.save(pending.files.flatMap((f) => [`outbox:${f.id}`, `ack:${f.id}`]));
    }
    async finishCompaction() {
      const pending = this.cache.compaction;
      if (!pending)
        return;
      if (useGoogleSyncDiagnostics.getState().compaction.status !== "running") {
        reportCompaction({ status: "running", reason: "resume", sourceFiles: pending.remove.length, newFiles: pending.files.length });
      }
      await this.sendFiles(pending, "pack");
      try {
        const manifest = await this.readPackManifest(pending.id);
        if (await digest(await encodeAsync(manifest)) !== await digest(await encodeAsync(pending.manifest))) {
          throw new Error("Sync pack publication mismatch.");
        }
        await this.loadPack(manifest, true);
        (this.cache.packs ??= {})[pending.id] = manifest;
      } catch (error2) {
        if (!(error2 instanceof SyncFileNotFoundError))
          throw error2;
        await this.discoverPacks();
        const replacements = Object.values(this.cache.packs ?? {}).filter((pack) => Object.keys(pack.commits).some((id) => Object.hasOwn(pending.manifest.commits, id)));
        for (const [id, hash] of Object.entries(pending.manifest.commits))
          if (!replacements.some((pack) => pack.commits[id] === hash)) {
            throw new Error("Missing compacted sync history.");
          }
        for (const pack of replacements)
          await this.loadPack(pack, true);
      }
      await this.refresh();
      await this.remote();
      syncPhase("saving");
      await this.parallel(pending.remove, (id) => this.transport.remove(id));
      for (const id of pending.remove) {
        delete this.cache.packs?.[id];
        delete this.cache.parts?.[id];
      }
      delete this.cache.compaction;
      await this.save(pending.files.flatMap((file) => [`outbox:${file.id}`, `ack:${file.id}`]));
      reportCompaction({ status: "completed", sourceFiles: pending.remove.length, newFiles: pending.files.length });
    }
    async compact(force = false) {
      if (this.transport.supportsCompaction === false)
        return;
      await this.finishCompaction();
      const covered = this.packedCommits();
      if (Object.keys(this.cache.commits).filter((id) => !covered.has(id)).length < (force ? 1 : COMPACT_COMMITS)) {
        reportCompaction({ status: "skipped", reason: "belowThreshold" });
        return;
      }
      await this.discoverPacks();
      const raw = await this.transport.commits(this.dataset);
      if (raw.length < (force ? 1 : COMPACT_COMMITS)) {
        reportCompaction({ status: "skipped", reason: "liveBelowThreshold" });
        return;
      }
      const groups = [];
      let group = { commits: [], sources: [], size: 0 };
      for (const id of raw.sort()) {
        const commit = this.cache.commits[id];
        if (!commit)
          continue;
        const size = Math.max((await encodeAsync(commit)).length, id.length + 128);
        if (group.commits.length && group.size + size > PACK_BYTES) {
          groups.push(group);
          group = { commits: [], sources: [], size: 0 };
        }
        const parts = this.cache.parts?.[id] ?? (await this.downloadManifest(id)).parts ?? [];
        group.commits.push(id);
        group.sources.push(id, ...parts);
        group.size += size;
      }
      if (group.commits.length)
        groups.push(group);
      for (const [id, pack] of Object.entries(this.cache.packs ?? {})) {
        const size = Math.max(pack.bytes, Object.keys(pack.commits).reduce((sum, commit) => sum + commit.length + 128, 0));
        const target = groups.find((group2) => group2.size + size <= PACK_BYTES);
        if (!target)
          continue;
        target.commits.push(...Object.keys(pack.commits));
        target.sources.push(id, ...pack.parts);
        target.size += size;
      }
      for (const group2 of groups) {
        const commits = Object.fromEntries([...new Set(group2.commits)].sort().map((id2) => [id2, this.cache.commits[id2]]));
        const payload = await encodeAsync({ version: 1, commits });
        const hashes = await hashCommitsAsync(commits);
        const [id, ...parts] = await this.transport.ids(1 + Math.ceil(payload.length / PACK_BYTES));
        const files = [];
        for (let i = 0; i < parts.length; i++) {
          const bytes3 = await encrypt(this.requireKey(), payload.slice(i * PACK_BYTES, (i + 1) * PACK_BYTES), this.context(parts[i]));
          files.push({ id: parts[i], kind: "pack-part", bytes: bytes3, size: bytes3.length, sent: false });
        }
        const manifest = { version: 1, commits: hashes, parts, bytes: payload.length };
        const bytes2 = await encrypt(this.requireKey(), await encodeAsync(manifest), this.context(id));
        if (bytes2.length > PACK_BYTES + 28)
          throw new Error("Sync pack index too large.");
        files.push({ id, kind: "pack", bytes: bytes2, size: bytes2.length, sent: false });
        this.cache.compaction = { id, manifest, files, remove: [...new Set(group2.sources)] };
        await this.save();
        reportCompaction({ status: "running", reason: "new", sourceFiles: this.cache.compaction.remove.length, newFiles: files.length });
        await this.finishCompaction();
      }
    }
    async prepare(changes, baseline, resolutions) {
      syncPhase("encrypting");
      const commit = { version: 1, parents: this.heads(), changes, ...resolutions ? { resolutions } : {} };
      const payload = await encodeAsync(commit);
      const inline = commit.parents.length > 0 && payload.length <= INLINE_BYTES;
      const partBytes = this.options.partBytes ?? PART_BYTES;
      const [id, ...parts] = await this.transport.ids(inline ? 1 : 1 + Math.ceil(payload.length / partBytes));
      syncPhase("encrypting", parts.length + 1);
      const files = [];
      for (let i = 0; i < parts.length; i++) {
        const bytes3 = await encrypt(this.requireKey(), payload.slice(i * partBytes, (i + 1) * partBytes), this.context(parts[i]));
        files.push({ id: parts[i], kind: "part", bytes: bytes3, size: bytes3.length, sent: false });
        completedFile(bytes3.length);
      }
      const bytes2 = await encrypt(this.requireKey(), await encodeAsync(inline ? { ...commit, version: 2 } : { version: 1, parts }), this.context(id));
      files.push({ id, kind: "commit", bytes: bytes2, size: bytes2.length, sent: false });
      completedFile(bytes2.length);
      this.encodedCommits.set(id, payload);
      this.cache.pending = { id, commit, baseline, files };
      await this.save();
    }
    // Import to remote only: preserve the current local baseline and remote records.
    async importSnapshot(snapshot) {
      const local = await syncStage(0, 6, () => toRecordsAsync(snapshot));
      await this.run(async () => {
        await syncStage(1, 6, async () => {
          await this.sendPending();
          await this.finishCompaction();
        });
        await syncStage(2, 6, () => this.refresh());
        const remote = await syncStage(3, 6, () => this.remote());
        await syncStage(4, 6, async () => {
          const merged = await mergeSyncRecords({}, local, remote);
          const changes = await diffRecords(remote, merged);
          if (changes.length) {
            await this.prepare(changes, this.cache.baseline);
            await this.sendPending();
          }
        });
        await syncStage(5, 6, async () => {
          await this.compact();
          await this.refresh();
          await this.remote();
        });
      });
    }
    async compactHistory() {
      await this.run(async () => {
        await syncStage(0, 4, async () => {
          await this.sendPending();
          await this.finishCompaction();
        });
        await syncStage(1, 4, () => this.refresh());
        await syncStage(2, 4, () => this.remote());
        await syncStage(3, 4, () => this.compact(true));
      });
    }
    async synchronize(snapshot, replace = false) {
      syncPhase("preparing");
      const local = await syncStage(0, 8, () => toRecordsAsync(snapshot));
      return this.run(async () => {
        await syncStage(1, 8, async () => {
          await this.sendPending();
          await this.finishCompaction();
        });
        await syncStage(2, 8, () => this.refresh());
        const remote = await syncStage(3, 8, () => this.remote());
        const { localHashes, changes } = await syncStage(4, 8, async () => {
          syncPhase("preparing");
          if (replace === "if-empty" && !this.cache.baseline && Object.keys(remote).length)
            throw new Error("Existing history must be downloaded before initializing sync.");
          if (!replace && !this.cache.baseline)
            throw new Error("Choose upload or download before enabling automatic sync.");
          const base = replace === true || replace === "if-empty" && !this.cache.baseline ? await hashRecordsAsync(remote) : this.cache.baseline;
          const localHashes2 = await hashRecordsAsync(local);
          const changes2 = await Promise.all(diffHashedRecords(base, local, localHashes2).filter((change) => {
            if (isBrowserLocalRecord(change.key))
              return false;
            const path = JSON.parse(change.key);
            return change.after !== null || path[0] !== "content" && path[0] !== "assets" && path[0] !== "contentEntries";
          }).map(async (change) => isNonBlockingRecord(change.key) ? { ...change, before: remote[change.key] === void 0 ? null : await digest(remote[change.key]) } : change));
          if (snapshot.state.chats?.length === 0 && Object.keys(remote).some((key) => JSON.parse(key)[0] === "chats" && JSON.parse(key).length > 1)) {
            throw new Error("Cloud sync skipped because the snapshot would erase all chats.");
          }
          const merged = await applyChanges(remote, changes2);
          for (const change of changes2) {
            if (change.after === null)
              continue;
            const selected = selectActivePath(change.key, [change.after, remote[change.key] ?? null], merged);
            if (selected !== void 0) {
              change.after = selected;
              if (selected === null)
                delete merged[change.key];
              else
                merged[change.key] = selected;
            }
          }
          try {
            await fromRecordsAsync(merged);
            await assertNoConcurrentOrphans(base, local, remote, merged);
          } catch (error2) {
            await fromRecordsAsync(local);
            await fromRecordsAsync(remote);
            throw new SyncConflictError(changes2.map((change) => change.key));
          }
          return { localHashes: localHashes2, changes: changes2 };
        });
        await syncStage(5, 8, async () => {
          if (changes.length) {
            await syncStage(0, 2, () => this.prepare(changes, localHashes));
            await syncStage(1, 2, () => this.sendPending());
          } else {
            this.cache.baseline = localHashes;
            await this.save();
          }
        });
        await syncStage(6, 8, () => this.compact());
        const finalRemote = await syncStage(7, 8, async () => {
          await this.refresh();
          return this.remote();
        });
        return fromRecordsAsync(finalRemote);
      });
    }
    async push(snapshot, replace = false) {
      await this.synchronize(snapshot, replace);
    }
    async coherentCloudRecords(remote) {
      let cloud = remote;
      if (Object.keys(this.remoteConflicts).length) {
        const heads = this.heads();
        const ancestors = (id, found = /* @__PURE__ */ new Set()) => {
          if (!found.has(id)) {
            found.add(id);
            this.cache.commits[id].parents.forEach((p) => ancestors(p, found));
          }
          return found;
        };
        const sets2 = heads.map((id) => ancestors(id));
        const common = [...sets2[0]].filter((id) => sets2.every((set) => set.has(id)));
        const base = common.length ? await hashRecordsAsync(await this.remote(false, common)) : {};
        cloud = await this.remote(false, [heads[0]]);
        for (const head of heads.slice(1))
          cloud = await mergeSyncRecords(base, cloud, await this.remote(false, [head]));
      }
      return cloud;
    }
    async overview() {
      return this.run(async () => {
        await this.refresh();
        const remote = await this.remote(true);
        const cloud = await this.coherentCloudRecords(remote);
        const snapshot = await fromRecordsAsync(cloud);
        return { ...await summarizeSyncSnapshot(snapshot), versions: this.heads().length };
      });
    }
    async inspect() {
      return this.run(async () => {
        await this.refresh();
        const remote = await this.remote(true);
        const heads = this.heads();
        const snapshot = await fromRecordsAsync(await this.coherentCloudRecords(remote));
        const versions = heads.length > 1 ? await Promise.all(heads.map(async (id) => ({
          id,
          snapshot: await fromRecordsAsync(await this.remote(false, [id]))
        }))) : [];
        return { snapshot, versions };
      });
    }
    async resolve(snapshot, mode) {
      const local = await syncStage(0, 8, () => toRecordsAsync(snapshot));
      return this.run(async () => {
        await syncStage(1, 8, async () => {
          await this.sendPending();
          await this.finishCompaction();
        });
        await syncStage(2, 8, () => this.refresh());
        const remote = await syncStage(3, 8, () => this.remote(true));
        const { result: result3, changes, resolutions } = await syncStage(4, 8, async () => {
          const resolutions2 = this.remoteConflicts;
          const cloud = await this.coherentCloudRecords(remote);
          const chosen = mode === "local" ? local : mode === "cloud" ? cloud : await mergeSyncRecords(this.cache.baseline ?? {}, local, cloud);
          const result4 = await fromRecordsAsync(chosen);
          const changes2 = await diffRecords(remote, chosen);
          for (const key of Object.keys(resolutions2))
            if (!changes2.some((change) => change.key === key)) {
              changes2.push({ key, before: remote[key] === void 0 ? null : await digest(remote[key]), after: chosen[key] ?? null });
            }
          return { result: result4, changes: changes2, resolutions: resolutions2 };
        });
        await syncStage(5, 8, async () => {
          if (changes.length) {
            await syncStage(0, 2, async () => this.prepare(changes, await hashRecordsAsync(local), Object.keys(resolutions).length ? resolutions : void 0));
            await syncStage(1, 2, () => this.sendPending());
          }
        });
        await syncStage(6, 8, async () => {
          if (changes.length) {
            await this.refresh();
            await this.remote();
          }
        });
        await syncStage(7, 8, () => this.compact());
        return result3;
      });
    }
    async pull(publishPending = true) {
      return this.run(async () => {
        await syncStage(0, 4, async () => {
          if (publishPending) {
            await this.sendPending();
            await this.finishCompaction();
          }
        });
        await syncStage(1, 4, () => this.refresh());
        const records = await syncStage(2, 4, () => this.remote());
        if (!Object.keys(records).length)
          throw new Error("This encrypted folder has no completed upload yet.");
        return syncStage(3, 4, () => fromRecordsAsync(records));
      });
    }
    // Call only after the existing local persistence has accepted the downloaded state.
    async acceptLocal(snapshot, discardPending = false) {
      syncPhase("saving");
      const baseline = await hashRecordsAsync(await toRecordsAsync(snapshot));
      await this.run(async () => {
        const remove = discardPending ? this.cache.pending?.files.flatMap((file) => [`outbox:${file.id}`, `ack:${file.id}`]) ?? [] : [];
        if (discardPending)
          delete this.cache.pending;
        this.cache.baseline = baseline;
        await this.save(remove);
      });
    }
  };

  // src/utils/chatFolders.ts
  var orderedFolders = (folders) => Object.values(folders).sort((a, b) => a.order - b.order);
  function applyFolderOperation(source, operation) {
    if (operation.type === "create") {
      if (!operation.id || Object.hasOwn(source.folders, operation.id))
        throw new Error("Folder ID already exists.");
      let index = 1;
      while (Object.values(source.folders).some((folder2) => folder2.name === `New Folder ${index}`))
        index++;
      const previous2 = Object.fromEntries(Object.entries(source.folders).map(([id, folder2]) => [id, { ...folder2, order: folder2.order + 1 }]));
      return { ...source, folders: { [operation.id]: { id: operation.id, name: `New Folder ${index}`, expanded: false, order: 0 }, ...previous2 } };
    }
    if (operation.type === "move") {
      if (operation.folderId !== void 0 && !Object.hasOwn(source.folders, operation.folderId))
        throw new Error("Folder does not exist.");
      if (operation.folderId === void 0 && operation.expandDestination === true)
        throw new Error("Unassigned destination cannot expand.");
      const ids = new Set(operation.chatIds);
      if ([...ids].some((id) => !source.chats?.some((chat) => chat.id === id)))
        throw new Error("Chat does not exist.");
      const chats = source.chats?.map((chat) => {
        if (!ids.has(chat.id))
          return chat;
        const { folder: _previous, ...rest } = chat;
        return operation.folderId === void 0 ? rest : { ...rest, folder: operation.folderId };
      });
      const folders2 = operation.folderId === void 0 || operation.expandDestination === false ? source.folders : {
        ...source.folders,
        ...Object.fromEntries(getFolderAncestors(source.folders, operation.folderId).map((id) => [id, { ...source.folders[id], expanded: true }]))
      };
      return { ...source, chats, folders: folders2 };
    }
    if (!Object.hasOwn(source.folders, operation.id))
      throw new Error("Folder does not exist.");
    if (operation.type === "remove") {
      const parentId = getFolderParentId(source.folders, operation.id);
      const folders2 = { ...source.folders };
      delete folders2[operation.id];
      for (const [id, folder2] of Object.entries(folders2))
        if (folder2.parentId === operation.id) {
          const { parentId: _previous, ...rest } = folder2;
          folders2[id] = parentId === void 0 ? rest : { ...rest, parentId };
        }
      const chats = source.chats?.map((chat) => {
        if (chat.folder !== operation.id)
          return chat;
        const { folder: _previous, ...rest } = chat;
        return parentId === void 0 ? rest : { ...rest, folder: parentId };
      });
      return { ...source, chats, folders: folders2 };
    }
    const patch = operation.type === "edit" ? operation.patch : operation.type === "rename" ? { name: operation.name } : operation.type === "expanded" ? { expanded: operation.expanded } : { color: operation.color || null };
    const previous = source.folders[operation.id];
    const folder = { ...previous, ...patch, color: patch.color === null ? void 0 : patch.color ?? previous.color };
    if (folder.color === void 0)
      delete folder.color;
    const folders = { ...source.folders, [operation.id]: folder };
    if (!validateFolderHierarchy(folders))
      throw new Error("Invalid folder hierarchy.");
    return { ...source, folders };
  }

  // shared/google-sync/folders.ts
  var folderFields = ["id", "name", "order", "expanded", "color", "parentId"];
  function difference(before, after, fields) {
    const set = Object.fromEntries(fields.filter((key) => Object.hasOwn(after, key) && (!Object.hasOwn(before, key) || before[key] !== after[key])).map((key) => [key, after[key]]));
    const remove = fields.filter((key) => Object.hasOwn(before, key) && !Object.hasOwn(after, key));
    return { set, remove };
  }
  function folderOperation(json) {
    const input = JSON.parse(json);
    const next = applyFolderOperation(input, input.operation);
    const folderChanges = Object.entries(next.folders).map(([key, folder]) => ({
      key,
      ...difference(Object.hasOwn(input.folders, key) ? input.folders[key] : {}, folder, folderFields)
    })).filter((change) => Object.keys(change.set).length || change.remove.length);
    const chatChanges = next.chats.map((chat, index) => ({ index, ...difference(input.chats[index], chat, ["folder"]) })).filter((change) => Object.keys(change.set).length || change.remove.length);
    return JSON.stringify({ folderKeys: Object.keys(next.folders), folderChanges, chatChanges });
  }
  function folderRows(json) {
    const input = JSON.parse(json);
    return JSON.stringify(orderedFolders(input.folders).map((folder) => ({
      ...Object.fromEntries(folderFields.filter((key) => Object.hasOwn(folder, key)).map((key) => [key, folder[key]])),
      path: getFolderAncestors(input.folders, folder.id).reverse().map((id) => input.folders[id].name).join(" / ")
    })));
  }

  // src/utils/reasoning.ts
  var getEffectiveVerbosity = (verbosity, allowMax) => verbosity === "max" && !allowMax ? "medium" : verbosity;
  var normalizeModelId = (modelId) => modelId.toLowerCase();
  var getClaudeVersion = (id) => {
    const match = /claude(?:-[a-z]+)*[-.](\d+(?:[.-]\d+)?)/.exec(id);
    if (!match)
      return void 0;
    const version = parseFloat(match[1].replace("-", "."));
    return Number.isFinite(version) ? version : void 0;
  };
  var isClaudeReasoningModel = (modelId) => {
    const id = normalizeModelId(modelId);
    if (!id.includes("claude"))
      return false;
    if (id.includes("thinking"))
      return true;
    const version = getClaudeVersion(id);
    if (version === void 0)
      return true;
    return version >= 3.7;
  };
  var isOpenRouterAdaptiveReasoningModel = (modelId, providerId) => {
    if (providerId !== "openrouter")
      return false;
    const id = normalizeModelId(modelId);
    if (!id.includes("claude"))
      return false;
    const version = getClaudeVersion(id);
    if (version === void 0)
      return true;
    return version >= 4.6;
  };
  var isOpenRouterClaudeEffortModel = (modelId, providerId) => {
    if (providerId !== "openrouter")
      return false;
    const id = normalizeModelId(modelId);
    if (!id.includes("claude"))
      return false;
    const version = getClaudeVersion(id);
    if (version === void 0)
      return true;
    return version >= 4.7;
  };
  var isOpenRouterClaudeVerbosityModel = (modelId, providerId) => {
    if (providerId !== "openrouter")
      return false;
    const id = normalizeModelId(modelId);
    const version = getClaudeVersion(id);
    if (version === void 0)
      return false;
    if (id.includes("opus"))
      return version >= 4.5;
    if (id.includes("sonnet"))
      return version >= 4.6;
    return /(?:fable|mythos)/.test(id) && version >= 5;
  };
  var supportsMaxVerbosity = (modelId, providerId) => {
    if (!isOpenRouterClaudeVerbosityModel(modelId, providerId))
      return false;
    const id = normalizeModelId(modelId);
    const version = getClaudeVersion(id);
    return version !== void 0 && version >= 4.6;
  };

  // src/api/providerModels.ts
  var REASONING_MODEL_RE = (
    // OpenAI o-series: o1, o1-mini, o3, o3-mini, o4-mini, etc.
    // Uses word-boundary to avoid false positives like "proto1", "falcon-40b"
    /(?:^|[-/])o[134](?:$|[-/])/
  );
  var REASONING_MODEL_NAMES = [
    "deepseek-r1",
    "deepseek-reasoner",
    "qwq"
  ];
  var isReasoningModel = (modelId) => {
    const id = modelId.toLowerCase();
    return REASONING_MODEL_RE.test(id) || REASONING_MODEL_NAMES.some((name) => id.includes(name)) || isClaudeReasoningModel(id);
  };

  // src/utils/modelReasoning.ts
  var inferMandatoryReasoning = (modelId, providerId) => providerId === "openrouter" && /claude-opus-5[.-]5(?:$|:)/.test(modelId.toLowerCase());
  function findProviderCustomModel(providerCustomModels, modelId, providerId) {
    if (!providerCustomModels)
      return void 0;
    if (providerId) {
      return providerCustomModels[providerId]?.find((m) => m.modelId === modelId);
    }
    for (const models of Object.values(providerCustomModels)) {
      if (!models)
        continue;
      const found = models.find((m) => m.modelId === modelId);
      if (found)
        return found;
    }
    return void 0;
  }
  function findFavorite(favorites, modelId, providerId) {
    if (providerId) {
      return favorites.find(
        (f) => f.modelId === modelId && f.providerId === providerId
      );
    }
    return favorites.find((f) => f.modelId === modelId);
  }
  function findCachedModel(cache, modelId, providerId) {
    if (providerId && cache[providerId]) {
      return cache[providerId].find((m) => m.id === modelId);
    }
    for (const models of Object.values(cache)) {
      if (!models)
        continue;
      const found = models.find((m) => m.id === modelId);
      if (found)
        return found;
    }
    return void 0;
  }
  function modelSupportsReasoning(state, modelId, providerId, modelSource) {
    if (modelSource === "local")
      return false;
    const inferred = isReasoningModel(modelId);
    const custom = findProviderCustomModel(state.providerCustomModels, modelId, providerId);
    if (custom?.supportsReasoning != null)
      return custom.supportsReasoning;
    const fav = findFavorite(state.favoriteModels ?? [], modelId, providerId);
    if (fav?.supportsReasoning != null)
      return fav.supportsReasoning || inferred;
    const cached = findCachedModel(state.providerModelCache ?? {}, modelId, providerId);
    if (cached?.supportsReasoning != null)
      return cached.supportsReasoning || inferred;
    return inferred;
  }
  function modelRequiresReasoning(state, modelId, providerId) {
    const favorite = findFavorite(state.favoriteModels ?? [], modelId, providerId);
    const cached = findCachedModel(state.providerModelCache ?? {}, modelId, providerId);
    return favorite?.reasoningMandatory ?? cached?.reasoningMandatory ?? inferMandatoryReasoning(modelId, providerId);
  }
  function buildReasoningCapabilities(config, supportsReasoning, requiresReasoning) {
    return { supportsReasoning, requiresReasoning: !!(supportsReasoning || config.force_reasoning) && config.providerId === "openrouter" && config.reasoning_effort === "none" && requiresReasoning() };
  }
  function getRequestReasoningCapabilities(config, state) {
    return buildReasoningCapabilities(
      config,
      modelSupportsReasoning(state, config.model, config.providerId),
      () => modelRequiresReasoning(state, config.model, config.providerId)
    );
  }

  // src/utils/tokenBudget.ts
  var UNKNOWN_MODEL_CONTEXT_LENGTH = 8192;
  var MIN_PROMPT_RATIO = 0.1;
  var normalizeContextLength = (contextLength) => Math.max(1, Math.floor(contextLength));
  var getMinPromptTokensForContext = (contextLength) => Math.max(1, Math.floor(normalizeContextLength(contextLength) * MIN_PROMPT_RATIO));
  var getMaxCompletionTokensForContext = (contextLength) => {
    const normalizedContextLength = normalizeContextLength(contextLength);
    return Math.max(0, normalizedContextLength - getMinPromptTokensForContext(normalizedContextLength));
  };

  // src/utils/remoteModelLimits.ts
  function remoteModelContextInfo(state, modelId, providerId) {
    const custom = findProviderCustomModel(state.providerCustomModels, modelId, providerId);
    if (custom?.contextLength)
      return { contextLength: custom.contextLength, isFallback: false };
    const fav = findFavorite(state.favoriteModels ?? [], modelId, providerId);
    if (fav?.contextLength)
      return { contextLength: fav.contextLength, isFallback: false };
    const cached = findCachedModel(state.providerModelCache ?? {}, modelId, providerId);
    if (cached?.contextLength)
      return { contextLength: cached.contextLength, isFallback: false };
    return { contextLength: UNKNOWN_MODEL_CONTEXT_LENGTH, isFallback: true };
  }
  function remoteModelStreamSupported(state, modelId, providerId) {
    const custom = findProviderCustomModel(state.providerCustomModels, modelId, providerId);
    if (custom?.streamSupport != null)
      return custom.streamSupport;
    const fav = findFavorite(state.favoriteModels ?? [], modelId, providerId);
    if (fav?.streamSupport != null)
      return fav.streamSupport;
    const cached = findCachedModel(state.providerModelCache ?? {}, modelId, providerId);
    if (cached?.streamSupport != null)
      return cached.streamSupport;
    return true;
  }
  function remoteModelDefaultMaxTokens(state, modelId, providerId) {
    const context = remoteModelContextInfo(state, modelId, providerId);
    const outputLimit = [
      findProviderCustomModel(state.providerCustomModels, modelId, providerId),
      findFavorite(state.favoriteModels ?? [], modelId, providerId),
      findCachedModel(state.providerModelCache ?? {}, modelId, providerId)
    ].map((model) => model?.maxCompletionTokens).find((limit) => limit != null && Number.isFinite(limit) && limit > 0);
    const contextLimit = getMaxCompletionTokensForContext(context.contextLength);
    if (outputLimit != null)
      return context.isFallback ? outputLimit : Math.min(outputLimit, contextLimit);
    return context.isFallback ? defaultUserMaxToken : contextLimit;
  }

  // src/utils/modelSettingsCore.ts
  var modelKey = ({ model, providerId, modelSource }) => JSON.stringify([modelSource === "local" ? "local" : "remote", providerId ?? "", model]);
  var defaultOpenRouterSettings = () => ({
    responseCache: { mode: "off" },
    stickySession: true
  });
  var pickModelSettings = (config) => ({
    openRouter: config.openRouter ? structuredClone(config.openRouter) : void 0,
    max_tokens: config.max_tokens,
    temperature: config.temperature,
    presence_penalty: config.presence_penalty,
    top_p: config.top_p,
    frequency_penalty: config.frequency_penalty,
    stream: config.stream,
    reasoning_effort: config.reasoning_effort,
    reasoning_budget_tokens: config.reasoning_budget_tokens,
    verbosity: config.verbosity,
    force_reasoning: config.force_reasoning
  });
  var savedModelSettings = (config, target, getModelDefaultMaxTokens) => {
    if (modelKey(config) === modelKey(target))
      return pickModelSettings(config);
    const saved = config.modelSettings?.[modelKey(target)];
    if (saved)
      return { ...saved, openRouter: saved.openRouter ? structuredClone(saved.openRouter) : void 0 };
    return {
      ...pickModelSettings(_defaultChatConfig),
      openRouter: target.providerId === "openrouter" && target.modelSource !== "local" ? defaultOpenRouterSettings() : void 0,
      max_tokens: getModelDefaultMaxTokens(target.model, target.providerId, target.modelSource)
    };
  };
  var switchConfigModel = (config, target, getModelDefaultMaxTokens) => {
    if (modelKey(config) === modelKey(target))
      return config;
    const modelSettings = {
      ...config.modelSettings,
      [modelKey(config)]: { ...config.modelSettings?.[modelKey(config)], ...pickModelSettings(config) }
    };
    return {
      ...config,
      ...savedModelSettings({ ...config, modelSettings }, target, getModelDefaultMaxTokens),
      ...target,
      modelSettings
    };
  };

  // src/utils/streamSupportCore.ts
  var normalizeConfigStream = (config, getModelDefaultMaxTokens, isModelStreamSupported) => ({
    ...config,
    max_tokens: config.max_tokens === defaultUserMaxToken ? getModelDefaultMaxTokens(config.model, config.providerId, config.modelSource) : config.max_tokens,
    stream: isModelStreamSupported(config.model, config.providerId, config.modelSource) ? config.stream !== false : false
  });

  // shared/google-sync/chatConfig.ts
  function normalizeRemoteConfig(config, modelState) {
    if (config.modelSource === "local")
      throw new Error("Local model configuration is not supported by this remote adapter.");
    return normalizeConfigStream(
      config,
      (model, providerId) => remoteModelDefaultMaxTokens(modelState, model, providerId),
      (model, providerId) => remoteModelStreamSupported(modelState, model, providerId)
    );
  }
  function chatConfig(json) {
    const input = JSON.parse(json);
    const state = input.modelState ?? {};
    let config = input.config;
    if (input.operation === "switch") {
      if (!input.target || input.target.modelSource === "local")
        throw new Error("Missing or unsupported remote model target.");
      config = switchConfigModel(
        config,
        { model: input.target.model, providerId: input.target.providerId, modelSource: input.target.modelSource },
        (model, providerId) => remoteModelDefaultMaxTokens(state, model, providerId)
      );
    } else if (input.operation !== "normalize")
      throw new Error("Unknown chat config operation.");
    const next = normalizeRemoteConfig(config, state);
    return JSON.stringify({ changes: diffJSONChanges(input.config, JSON.parse(JSON.stringify(next))) });
  }

  // src/api/requestBody.ts
  var OPENROUTER_ONLY_EFFORTS = /* @__PURE__ */ new Set([
    "none",
    "minimal",
    "xhigh"
  ]);
  var needsMaxTokensOnly = (modelId) => {
    const id = modelId.toLowerCase();
    return id.includes("claude");
  };
  var EFFORT_TO_MAX_TOKENS = {
    none: 0,
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16384,
    xhigh: 32768
  };
  var buildRequestBody = (messages, config, capabilities, overrides) => {
    const {
      providerId,
      reasoning_effort,
      reasoning_budget_tokens,
      verbosity,
      force_reasoning,
      modelSettings,
      openRouter,
      systemPrompt,
      modelSource,
      ...apiConfig
    } = config;
    const body = {
      messages: messages.map(({ role, content }) => ({ role, content })),
      ...apiConfig,
      max_tokens: config.max_tokens > 0 ? config.max_tokens : void 0,
      ...overrides
    };
    if (capabilities.supportsReasoning || force_reasoning) {
      if (providerId === "openrouter") {
        const reasoning = {};
        const isEffortClaude = isOpenRouterClaudeEffortModel(config.model, providerId);
        if (reasoning_effort === "none") {
          if (capabilities.requiresReasoning) {
            reasoning.effort = "low";
          } else {
            reasoning.enabled = false;
          }
        } else if (reasoning_budget_tokens && reasoning_budget_tokens > 0 && !isEffortClaude) {
          reasoning.max_tokens = reasoning_budget_tokens;
        } else if (reasoning_effort) {
          if (isEffortClaude) {
            reasoning.effort = reasoning_effort === "minimal" ? "low" : reasoning_effort;
          } else if (isOpenRouterAdaptiveReasoningModel(config.model, providerId)) {
            reasoning.enabled = true;
            reasoning.effort = reasoning_effort === "minimal" ? "low" : reasoning_effort;
          } else if (needsMaxTokensOnly(config.model)) {
            const mapped = EFFORT_TO_MAX_TOKENS[reasoning_effort];
            if (mapped > 0)
              reasoning.max_tokens = mapped;
          } else {
            reasoning.effort = reasoning_effort;
          }
        }
        if (Object.keys(reasoning).length > 0) {
          body.reasoning = reasoning;
        }
      } else {
        if (reasoning_effort && !OPENROUTER_ONLY_EFFORTS.has(reasoning_effort)) {
          body.reasoning_effort = reasoning_effort;
        }
        if (reasoning_budget_tokens && reasoning_budget_tokens > 0) {
          body.reasoning_budget_tokens = reasoning_budget_tokens;
        }
      }
    }
    if (isOpenRouterClaudeVerbosityModel(config.model, providerId) && verbosity) {
      body.verbosity = getEffectiveVerbosity(verbosity, supportsMaxVerbosity(config.model, providerId));
    }
    return body;
  };

  // src/utils/submitContext.ts
  var modelSupportsSystemRole = (modelId) => {
    return !isReasoningModel2(modelId);
  };
  var isReasoningModel2 = (modelId) => modelId.startsWith("o1-") || modelId.startsWith("o3-") || modelId.startsWith("o1 ");
  var sanitizeMessageContent = (content) => content.filter((part) => {
    if (part.type === "reasoning")
      return false;
    if (isImageContent(part))
      return true;
    if (isToolCallContent(part) || isToolResultContent(part))
      return true;
    return isTextContent(part) && part.text.trim().length > 0;
  });
  var hasToolContent = (message) => message.content.some((c) => isToolCallContent(c) || isToolResultContent(c));
  var ensureRoleAlternation = (messages) => {
    const result3 = [];
    for (const msg of messages) {
      if (result3.length > 0 && result3[result3.length - 1].role === msg.role && !hasToolContent(result3[result3.length - 1]) && !hasToolContent(msg)) {
        const prev = result3[result3.length - 1];
        result3[result3.length - 1] = {
          ...prev,
          content: [...prev.content, ...msg.content]
        };
      } else {
        result3.push(msg);
      }
    }
    return result3;
  };
  var filterOmittedMessages = (messages, activePath, omittedNodes) => {
    if (Object.keys(omittedNodes).length === 0)
      return messages;
    return messages.filter((_23, idx) => {
      const nodeId = activePath?.[idx] ?? String(idx);
      if (!omittedNodes[nodeId])
        return true;
      if (hasToolContent(messages[idx]))
        return true;
      return false;
    });
  };
  var sanitizeMessagesForSubmit = (messages) => ensureRoleAlternation(
    messages.map((message) => ({
      ...message,
      content: sanitizeMessageContent(message.content)
    })).filter((message) => message.content.length > 0)
  );
  var getSubmitContextMessages = (messages, messageIndex, modelId, activePath, omittedNodes = {}, systemPrompt, summaryContext) => {
    const sliced = messages.slice(0, messageIndex);
    const filtered = summaryContext ? applyBubbleSummariesForSubmit({ ...summaryContext.chat, messages, omittedNodes }, messageIndex, summaryContext.generatingNodeIds) : filterOmittedMessages(sliced, activePath, omittedNodes);
    const withoutSystem = filtered.filter((m) => m.role !== "system");
    const sanitized = sanitizeMessagesForSubmit(withoutSystem);
    const supportsSystem = modelId ? modelSupportsSystemRole(modelId) : true;
    if (systemPrompt && supportsSystem) {
      return [
        { role: "system", content: [{ type: "text", text: systemPrompt }] },
        ...sanitized
      ];
    }
    return sanitized;
  };

  // shared/google-sync/generation.ts
  var generationRequest = (json) => {
    const input = JSON.parse(json);
    if (input.modelState !== void 0)
      input.config = normalizeRemoteConfig(input.config, input.modelState);
    const path = input.activePath ?? input.chat?.branchTree?.activePath;
    let chat = input.chat;
    if (chat?.branchTree && input.contentStore) {
      const branchTree = { ...chat.branchTree, activePath: path };
      chat = { ...chat, branchTree, messages: materializeActivePath(branchTree, input.contentStore) };
    }
    const projected = chat?.messages ?? input.messages ?? [];
    const messages = getSubmitContextMessages(
      projected,
      projected.length,
      input.config.model,
      path,
      input.omittedNodes ?? chat?.omittedNodes,
      input.config.systemPrompt,
      chat ? { chat, generatingNodeIds: input.generatingNodeIds ?? [] } : void 0
    );
    if (messages.length === 0)
      throw new Error("\u9001\u4FE1\u3059\u308B\u672C\u6587\u304C\u3042\u308A\u307E\u305B\u3093");
    return JSON.stringify(buildRequestBody(
      messages,
      input.config,
      input.modelState !== void 0 ? getRequestReasoningCapabilities(input.config, input.modelState) : input.capabilities,
      { stream: input.config.stream }
    ));
  };

  // src/utils/chatShallowClone.ts
  var deepCloneSingleChat = (chat, id = editingUUID()) => {
    return {
      ...structuredClone(chat),
      id
    };
  };

  // src/utils/chatLibrary.ts
  function createLibraryChat(id, title, config, imageDetail, systemPrompt, folder) {
    return {
      id,
      title: title ? title : "New Chat",
      messages: [],
      config: {
        ...structuredClone(config),
        reasoning_effort: config.reasoning_effort ?? "none",
        reasoning_budget_tokens: config.reasoning_budget_tokens ?? 0,
        systemPrompt: systemPrompt || void 0
      },
      titleSet: false,
      folder,
      imageDetail
    };
  }
  function addLibraryChat(chats, create) {
    let index = 1;
    while (chats.some((chat) => chat.title === `New Chat ${index}`))
      index++;
    return [create(`New Chat ${index}`), ...chats];
  }
  function renameLibraryChat(chats, index, title) {
    const updated = chats.slice();
    updated[index] = { ...chats[index], title };
    return updated;
  }
  var copyEntries = (store) => Object.fromEntries(Object.entries(store).map(([hash, entry]) => [hash, { ...entry }]));
  function duplicateLibraryChat(chats, index, store, newID, scope = "all") {
    const original = chats[index];
    let title = `Copy of ${original.title}`, suffix = 0;
    while (chats.some((chat2) => chat2.title === title))
      title = `Copy ${++suffix} of ${original.title}`;
    const snapshot = finalizeStreamingSnapshotState([original], store);
    const frozen = snapshot.chats[0];
    const chat = deepCloneSingleChat(scope === "activePath" ? prepareChatForExport(frozen, snapshot.contentStore, { visibleBranchOnly: true }).chat : frozen, newID);
    chat.title = title;
    const contentStore = { ...store };
    for (const node of Object.values(chat.branchTree?.nodes ?? {})) {
      const entry = contentStore[node.contentHash];
      contentStore[node.contentHash] = entry ? { ...entry } : { ...snapshot.contentStore[node.contentHash], refCount: 0 };
      retainContent(contentStore, node.contentHash);
    }
    return { chats: [chat, ...chats], contentStore };
  }
  function deleteLibraryChats(chats, indices, store, create) {
    const selected = new Set(indices);
    const remaining = chats.filter((_23, index) => !selected.has(index));
    const removed = /* @__PURE__ */ new Map();
    for (const [index, chat] of chats.entries()) {
      if (!selected.has(index))
        continue;
      for (const node of Object.values(chat.branchTree?.nodes ?? {})) {
        if (isStreamingContentHash(node.contentHash))
          continue;
        removed.set(node.contentHash, (removed.get(node.contentHash) ?? 0) + 1);
      }
    }
    for (const [hash, count] of removed) {
      if (!Object.hasOwn(store, hash) || !Number.isInteger(store[hash].refCount) || store[hash].refCount < count) {
        throw new Error("Invalid message reference count; conversation was not deleted.");
      }
    }
    const contentStore = copyEntries(store);
    for (const [index, chat] of chats.entries()) {
      if (!selected.has(index))
        continue;
      for (const node of Object.values(chat.branchTree?.nodes ?? {}))
        releaseContent(contentStore, node.contentHash);
    }
    if (!remaining.length)
      return { chats: [create()], contentStore };
    return { chats: remaining, contentStore };
  }

  // shared/google-sync/library.ts
  function libraryOperation(json) {
    const input = JSON.parse(json);
    const { chats, contentStore, operation } = input;
    const indexOf = (id) => {
      const index = chats.findIndex((chat) => chat.id === id);
      if (index < 0)
        throw new Error("Unknown chat ID.");
      return index;
    };
    const validateNewID = () => {
      if (!operation.newID || chats.some((chat) => chat.id === operation.newID))
        throw new Error("Invalid new chat ID.");
    };
    const create = (title) => {
      validateNewID();
      if (!input.defaults)
        throw new Error("Missing chat defaults.");
      return createLibraryChat(
        operation.newID,
        title,
        input.defaults.config,
        input.defaults.imageDetail,
        input.defaults.config.systemPrompt,
        operation.folder
      );
    };
    let next = { chats, contentStore };
    switch (operation.type) {
      case "create":
        next = { chats: addLibraryChat(chats, create), contentStore };
        break;
      case "rename":
        if (typeof operation.title !== "string")
          throw new Error("Invalid chat title.");
        next = { chats: renameLibraryChat(chats, indexOf(operation.id), operation.title), contentStore };
        break;
      case "duplicate":
        validateNewID();
        next = duplicateLibraryChat(chats, indexOf(operation.id), contentStore, operation.newID);
        break;
      case "delete": {
        if (!operation.ids?.length || new Set(operation.ids).size !== operation.ids.length)
          throw new Error("Invalid chat selection.");
        next = deleteLibraryChats(chats, operation.ids.map(indexOf), contentStore, create);
        break;
      }
      default:
        throw new Error("Unknown library operation.");
    }
    return JSON.stringify(diffJSONChanges({ chats, contentStore }, JSON.parse(JSON.stringify(next))));
  }
  var libraryDefaults = () => JSON.stringify({
    config: { ..._defaultChatConfig, systemPrompt: defaultSystemMessage },
    imageDetail: _defaultImageDetail
  });

  // src/utils/syncDocument.ts
  var import_lodash2 = __toESM(require_lodash(), 1);

  // src/store/chat-edit-time.ts
  var nodeContent = (node) => [node.parentId, node.role, node.contentHash, node.label, node.starred, node.pinned];
  var chatContent = (chat) => [
    chat.title,
    chat.folder,
    chat.config,
    chat.imageDetail,
    chat.titleSet,
    chat.omittedNodes,
    chat.protectedNodes,
    chat.branchTree ? void 0 : chat.messages
  ];
  function recordChatEdits(previous, next, now) {
    const byId = new Map(previous?.map((chat) => [chat.id, chat]));
    let changed = (previous?.length ?? 0) !== next.length;
    const chats = next.map((chat) => {
      const before = byId.get(chat.id);
      if (chat === before)
        return chat;
      let edited = !before || JSON.stringify(chatContent(chat)) !== JSON.stringify(chatContent(before));
      let tree = chat.branchTree;
      if (tree && tree !== before?.branchTree) {
        const nodes = { ...tree.nodes };
        let nodesEdited = Object.keys(nodes).length !== Object.keys(before?.branchTree?.nodes ?? {}).length;
        for (const [id, node] of Object.entries(nodes)) {
          const old = before?.branchTree?.nodes[id];
          if (!old || node !== old && JSON.stringify(nodeContent(node)) !== JSON.stringify(nodeContent(old))) {
            nodes[id] = { ...node, updatedAt: !old ? node.updatedAt ?? now : now };
            nodesEdited = true;
          }
        }
        if (nodesEdited)
          tree = { ...tree, nodes };
        edited ||= nodesEdited;
      } else if (before?.branchTree && !tree)
        edited = true;
      if (!edited)
        return chat;
      changed = true;
      return { ...chat, branchTree: tree, updatedAt: !before ? chat.updatedAt ?? now : now };
    });
    return { chats, changed };
  }
  function hasFolderContentEdits(previous, next) {
    const contents = (folders) => Object.entries(folders).map(([id, folder]) => [id, folder.name, folder.order, folder.color, folder.parentId]);
    return JSON.stringify(contents(next)) !== JSON.stringify(contents(previous));
  }

  // src/utils/syncDocument.ts
  var DOCUMENT_SHARED_ROOTS = ["chats", "contentStore", "folders", "evaluationSettings", "evaluationResults"];
  var has = (value, key) => Object.hasOwn(value, key);
  var object = (value, name) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`Invalid ${name}.`);
    return value;
  };
  var shared = (key) => DOCUMENT_SHARED_ROOTS.some((root) => root === key);
  var sidecarOf = (v3) => Object.fromEntries(Object.entries(v3).filter(([key]) => key !== "version" && !shared(key)));
  function validate(document2) {
    object(document2.snapshot, "snapshot");
    object(document2.snapshot.state, "snapshot state");
    object(document2.v3Sidecar, "V3 sidecar");
    if (!Number.isInteger(document2.snapshot.version))
      throw new Error("Invalid snapshot version.");
    if (Object.keys(document2.v3Sidecar).some((key) => key === "version" || shared(key)))
      throw new Error("Invalid V3 sidecar roots.");
  }
  function v3Object(v3) {
    object(v3, "V3 document");
    if (v3.version !== 3)
      throw new Error("Unsupported V3 document version.");
  }
  function v3DocumentLayout(v3) {
    v3Object(v3);
    return { version: STORE_VERSION, sharedRoots: Object.keys(v3).filter(shared), sidecarRoots: Object.keys(sidecarOf(v3)) };
  }
  function createSyncDocument(input) {
    let result3;
    if ("snapshot" in input)
      result3 = { snapshot: structuredClone(input.snapshot), v3Sidecar: structuredClone(input.v3Sidecar ?? {}) };
    else {
      v3Object(input.v3);
      result3 = { snapshot: { version: STORE_VERSION, state: Object.fromEntries(Object.entries(input.v3).filter(([key]) => shared(key))) }, v3Sidecar: sidecarOf(input.v3) };
      result3 = structuredClone(result3);
    }
    validate(result3);
    return result3;
  }
  function projectSyncDocument(document2) {
    validate(document2);
    const state = document2.snapshot.state;
    const store = object(state.contentStore ?? {}, "content store");
    const expanded = Object.fromEntries(Object.entries(store).map(([hash, entry]) => {
      const { delta: _delta, ...metadata } = entry;
      return [hash, { ...structuredClone(metadata), content: structuredClone(resolveContent(store, hash)) }];
    }));
    const chats = structuredClone(state.chats ?? []);
    if (!Array.isArray(chats))
      throw new Error("Invalid chats.");
    for (const chat of chats)
      if (chat.branchTree) {
        captureProjectedMessageAttributes(chat, store);
        chat.messages = materializeActivePath(chat.branchTree, store, true);
      }
    const projection = { ...structuredClone(document2.v3Sidecar), version: 3 };
    for (const root of DOCUMENT_SHARED_ROOTS)
      if (has(state, root))
        projection[root] = structuredClone(state[root]);
    return { ...projection, chats, contentStore: expanded, folders: projection.folders ?? {} };
  }
  function result(before, document2) {
    const persisted = JSON.parse(JSON.stringify(document2));
    const changes = diffJSONChanges(before, persisted);
    return { document: persisted, changes };
  }
  function applySyncDocumentEdits(document2, before, edited, now = Date.now()) {
    validate(document2);
    v3Object(edited);
    if (!(0, import_lodash2.isEqual)(before, projectSyncDocument(document2)))
      throw new Error("Stale document projection.");
    const next = structuredClone(document2), state = next.snapshot.state;
    for (const root of DOCUMENT_SHARED_ROOTS) {
      if (has(before, root) === has(edited, root) && orderedJSONEqual(before[root], edited[root]))
        continue;
      if (!has(edited, root)) {
        delete state[root];
        continue;
      }
      if (root === "contentStore" && edited[root] !== null) {
        state[root] = Object.fromEntries(Object.entries(object(edited[root], root)).map(([hash, entry]) => {
          const original = document2.snapshot.state[root]?.[hash];
          if (original && orderedJSONEqual(before[root]?.[hash], entry))
            return [hash, structuredClone(original)];
          const updated = structuredClone(object(entry, "content entry"));
          if (original?.delta && orderedJSONEqual(before[root]?.[hash]?.content, updated.content)) {
            updated.content = structuredClone(original.content);
            updated.delta = structuredClone(original.delta);
          }
          return [hash, updated];
        }));
      } else if (root === "chats" && Array.isArray(edited[root])) {
        state[root] = edited[root].map((chat) => {
          const original = document2.snapshot.state.chats?.find((item) => item.id === chat.id), previous = before.chats?.find((item) => item.id === chat.id);
          const updated = structuredClone(chat);
          if (!original || original.id !== chat.id)
            return updated;
          for (const key of Object.keys(updated))
            if (has(previous, key) && orderedJSONEqual(previous[key], updated[key])) {
              if (has(original, key))
                updated[key] = structuredClone(original[key]);
              else
                delete updated[key];
            }
          return updated;
        });
      } else
        state[root] = structuredClone(edited[root]);
    }
    const edits = Array.isArray(state.chats) && !orderedJSONEqual(before.chats, edited.chats) ? recordChatEdits(before.chats, state.chats, now) : void 0;
    const foldersEdited = has(edited, "folders") && !orderedJSONEqual(before.folders, edited.folders) && hasFolderContentEdits(before.folders ?? {}, edited.folders ?? {});
    if (edits)
      state.chats = edits.chats;
    if (edits?.changed || foldersEdited)
      state.lastContentEditedAt = now;
    next.v3Sidecar = { ...next.v3Sidecar, ...structuredClone(sidecarOf(edited)) };
    return result(document2, next);
  }
  function mergeSyncDocumentSnapshot(document2, incoming) {
    validate(document2);
    createSyncDocument({ snapshot: incoming });
    const next = { snapshot: { ...structuredClone(document2.snapshot), ...structuredClone(incoming), state: { ...structuredClone(document2.snapshot.state), ...structuredClone(incoming.state) } }, v3Sidecar: structuredClone(document2.v3Sidecar) };
    return result(document2, next);
  }

  // src/store/storage/google/records.ts
  var import_diff_match_patch3 = __toESM(require_diff_match_patch(), 1);
  var dmp3 = new import_diff_match_patch3.default();
  function resolveStrict2(store, hash, visited = /* @__PURE__ */ new Set()) {
    const entry = store[hash];
    if (!entry || visited.has(hash) || visited.size >= 100)
      throw new Error("Missing or cyclic message content; sync stopped.");
    if (!entry.delta)
      return entry.content;
    visited.add(hash);
    const base = resolveStrict2(store, entry.delta.baseHash, visited);
    const [text, applied] = dmp3.patch_apply(dmp3.patch_fromText(entry.delta.patches), JSON.stringify(base));
    if (applied.some((ok) => !ok))
      throw new Error("Invalid message delta; sync stopped.");
    return JSON.parse(text);
  }

  // shared/google-sync/document.ts
  function documentOperation(json) {
    const input = JSON.parse(json);
    switch (input.operation) {
      case "resolveStore":
        return JSON.stringify(Object.fromEntries(Object.entries(input.store).filter(([hash, entry]) => entry.delta && (!input.hashes || input.hashes.includes(hash))).map(([hash]) => {
          if (input.strict)
            resolveStrict2(input.store, hash);
          return [hash, resolveDeltaContentJSON(input.store, hash) ?? "[]"];
        })));
      case "syncSnapshot": {
        if (input.received.version !== STORE_VERSION)
          throw new Error("The downloaded snapshot uses a different data version; it was preserved without replacing local chats.");
        const shared2 = withoutBrowserLocalSettings(input.received.state);
        const next = mergeSyncDocumentSnapshot(input.document, { ...input.received, state: shared2 }).document;
        if (shared2.contentStore) {
          const expanded = projectSyncDocument(input.document).contentStore;
          for (const [hash, entry] of Object.entries(shared2.contentStore)) {
            if (orderedJSONEqual(expanded[hash], entry) && input.document.snapshot.state.contentStore?.[hash])
              next.snapshot.state.contentStore[hash] = input.document.snapshot.state.contentStore[hash];
          }
        }
        const original = input.document.snapshot;
        const replacedChats = /* @__PURE__ */ new Set();
        const changes = diffJSONChanges(original, next.snapshot).flatMap((change) => {
          if (change.path[0] === "state" && change.path[1] === "chats" && typeof change.path[2] === "number") {
            const index = change.path[2], chat = next.snapshot.state.chats[index];
            if (chat && original.state.chats?.[index]?.id !== chat.id) {
              if (replacedChats.has(index))
                return [];
              replacedChats.add(index);
              return [{ op: "set", path: ["state", "chats", index], value: chat }];
            }
          }
          return [change];
        }).map((change) => {
          if (change.op !== "set")
            return change;
          let sourcePath = [...change.path];
          if (sourcePath[0] === "state" && sourcePath[1] === "chats" && typeof sourcePath[2] === "number") {
            const chat = next.snapshot.state.chats[sourcePath[2]];
            const index = original.state.chats?.findIndex((item) => item.id === chat.id) ?? -1;
            if (index < 0)
              return change;
            sourcePath[2] = index;
          }
          const read = (path) => path.reduce((value2, key) => value2?.[key], original);
          const rawSources = [];
          const protect = (value2, path, source) => {
            const previous = read(source);
            if (previous !== void 0 && orderedJSONEqual(previous, value2)) {
              rawSources.push({ path, sourcePath: source });
              return null;
            }
            if (Array.isArray(value2))
              return value2.map((item, index) => protect(item, [...path, index], [...source, index]));
            if (value2 && typeof value2 === "object")
              return Object.fromEntries(Object.entries(value2).map(([key, item]) => [key, protect(item, [...path, key], [...source, key])]));
            return value2;
          };
          const value = protect(change.value, [], sourcePath);
          return { ...change, value, rawSources };
        });
        return JSON.stringify(changes);
      }
      case "v3Layout":
        return JSON.stringify(v3DocumentLayout(input.v3));
      case "project":
        return JSON.stringify(projectSyncDocument(input.document));
      case "applyEdits": {
        let changes = applySyncDocumentEdits(input.document, input.before, input.edited, input.now).changes;
        for (const hash of input.deltaEntries ?? []) {
          const before = input.before.contentStore?.[hash], edited = input.edited.contentStore?.[hash];
          if (edited && !orderedJSONEqual(before?.content, edited.content)) {
            const contentPath = ["snapshot", "state", "contentStore", hash, "content"];
            changes = changes.filter((change) => !contentPath.every((part, index) => change.path[index] === part));
            changes.push({ op: "set", path: contentPath, value: edited.content });
            changes.push({ op: "remove", path: ["snapshot", "state", "contentStore", hash, "delta"] });
          }
        }
        return JSON.stringify(changes);
      }
      case "importV3": {
        const layout = v3DocumentLayout(input.v3);
        mergeSyncDocumentSnapshot(input.document, { version: input.document.snapshot.version, state: {} });
        return JSON.stringify([
          ...layout.sharedRoots.map((key) => ({ op: "set", path: ["snapshot", "state", key], source: "v3", sourcePath: [key] })),
          ...layout.sidecarRoots.map((key) => ({ op: "set", path: ["v3Sidecar", key], source: "v3", sourcePath: [key] }))
        ]);
      }
      case "mergeSnapshot": {
        mergeSyncDocumentSnapshot(input.document, input.incoming);
        const changes = Object.keys(input.incoming).filter((key) => key !== "state").map((key) => ({
          op: "set",
          path: ["snapshot", key],
          source: "incoming",
          sourcePath: [key]
        }));
        changes.push(...Object.keys(input.incoming.state).map((key) => ({
          op: "set",
          path: ["snapshot", "state", key],
          source: "incoming",
          sourcePath: ["state", key]
        })));
        return JSON.stringify(changes);
      }
      default:
        throw new Error("Unsupported document operation.");
    }
  }
  function messageAttributesOperation(json) {
    const input = JSON.parse(json);
    switch (input.operation) {
      case "captureDocument":
      case "exportDocument": {
        const changed = structuredClone(input.source);
        for (const chat of changed.chats) {
          if (input.operation === "captureDocument")
            captureProjectedMessageAttributes(chat, changed.contentStore);
          const attributes = chat.branchTree && readMessageAttributes(chat.branchTree);
          if (input.operation === "exportDocument" && attributes)
            chat.messages = materializeActivePath(chat.branchTree, changed.contentStore, true);
        }
        if (changed.branchClipboard != null)
          readMessageAttributes(changed.branchClipboard);
        return JSON.stringify(diffJSONChanges(input.source, changed));
      }
      case "read":
        return JSON.stringify(readMessageAttributes(input.owner)?.byNode ?? null);
      case "extras":
        return JSON.stringify(extraMessageAttributes(input.message));
      case "setting": {
        const changed = structuredClone(input.owner);
        setMessageAttributes(changed, input.nodeID, input.message);
        return JSON.stringify(diffJSONChanges(input.owner, changed));
      }
      case "copying": {
        const changed = structuredClone(input.target);
        copyMessageAttributes(input.source, input.nodeID, changed, input.newID);
        return JSON.stringify(diffJSONChanges(input.target, changed));
      }
      case "capture": {
        const changed = structuredClone(input.chat);
        captureProjectedMessageAttributes(changed, input.store);
        return JSON.stringify(diffJSONChanges(input.chat, changed));
      }
      case "projecting":
        return JSON.stringify(projectMessageAttributes(input.owner, input.nodeID, input.message));
      default:
        throw new Error("Unsupported message attributes operation.");
    }
  }

  // src/utils/chatMarkdown.ts
  var chatToMarkdown = (chat) => {
    let markdown = `# ${chat.title}

`;
    let i = 0;
    while (i < chat.messages.length) {
      let message = chat.messages[i];
      let messageContent = contentToMarkdown(message.content);
      while (hasUnclosedCodeBlock(messageContent) && i + 1 < chat.messages.length && chat.messages[i + 1].role === message.role) {
        i++;
        messageContent += contentToMarkdown(chat.messages[i].content);
      }
      if (hasUnclosedCodeBlock(messageContent)) {
        messageContent += "\n```\n";
      }
      markdown += `### **${message.role}**:

${messageContent}---

`;
      i++;
    }
    return markdown;
  };
  var contentToMarkdown = (contents) => {
    let text = "";
    contents.forEach((content) => {
      if (content) {
        if (isTextContent(content)) {
          text += content.text;
        } else if (isImageContent(content)) {
          text += `![image](${content.image_url.url})`;
        }
        text += "\n\n";
      }
    });
    return text;
  };
  var hasUnclosedCodeBlock = (text) => {
    if (!text) {
      return false;
    }
    const codeBlockPattern = /```/g;
    const matches = text.match(codeBlockPattern);
    return matches ? matches.length % 2 !== 0 : false;
  };

  // src/utils/fileExport.ts
  function buildFileExportPayload(input) {
    const { v3, scope, format } = input;
    if (v3.version !== 3)
      throw new Error("Unsupported export source.");
    if (format === "openrouter" && input.visibleBranchOnly)
      throw new Error("OpenRouter export uses the current branch; a separate branch scope is unsupported.");
    const store = v3.contentStore;
    if (scope === "all") {
      switch (format) {
        case "v3":
          return { ...v3, contentStore: buildExportContentStore(store) };
        case "v1":
          return { chats: v3.chats?.map((chat2) => {
            const expanded = { ...chat2 };
            if (expanded.branchTree)
              expanded.messages = prepareChatForExport(chat2, store).chat.messages;
            const { branchTree, collapsedNodes, ...rest } = expanded;
            return rest;
          }), folders: v3.folders, version: 1 };
        case "openai":
          return v3.chats?.map((chat2) => chatToOpenAIFormat(chat2, store)) ?? [];
        case "openrouter":
          return v3.chats?.map((chat2) => chatToOpenRouterFormat(chat2, store)) ?? [];
        case "lmstudio":
          return v3.chats?.map((chat2) => chatToLMStudioFormat(chat2, store)) ?? [];
        default:
          throw new Error("Unsupported all-chat export format.");
      }
    }
    if (scope !== "chat")
      throw new Error("Invalid export scope.");
    let chat = v3.chats?.find((chat2) => chat2.id === input.chatId);
    if (!chat)
      throw new Error("Export chat is missing.");
    if (input.visiblePath && chat.branchTree) {
      if (input.visiblePath.some((id) => !Object.hasOwn(chat.branchTree.nodes, id)))
        throw new Error("Invalid export viewing path.");
      chat = switchActivePathState([chat], 0, input.visiblePath, store)[0];
    }
    const options = { visibleBranchOnly: input.visibleBranchOnly };
    switch (format) {
      case "v3": {
        const prepared = prepareChatForExport(chat, store, options), exportedChat = { ...prepared.chat };
        delete exportedChat.folder;
        return {
          chats: [exportedChat],
          contentStore: prepared.contentStore,
          folders: {},
          evaluationSettings: v3.evaluationSettings,
          evaluationResults: Object.fromEntries(Object.entries(v3.evaluationResults ?? {}).filter(([key]) => key.startsWith(`${chat.id}:`))),
          version: 3
        };
      }
      case "openai":
        return [chatToOpenAIFormat(chat, store, options)];
      case "openrouter":
        return chatToOpenRouterFormat(chat, store);
      case "lmstudio":
        return chatToLMStudioFormat(chat, store, options);
      case "markdown":
        return chatToMarkdown(input.visibleBranchOnly ? prepareChatForExport(chat, store, options).chat : chat);
      default:
        throw new Error("Unsupported single-chat export format.");
    }
  }

  // shared/google-sync/fileExport.ts
  function fileExport(json) {
    const input = JSON.parse(json);
    const payload = buildFileExportPayload(input);
    return JSON.stringify({ payload, ...input.scope === "all" && input.format === "v3" ? { payloadChanges: diffJSONChanges(input.v3, JSON.parse(JSON.stringify(payload))) } : {}, mimeType: input.format === "markdown" ? "text/markdown" : "application/json", extension: input.format === "markdown" ? "md" : "json" });
  }

  // shared/google-sync/composer.ts
  function composerContent(json) {
    const input = JSON.parse(json);
    if (input.operation !== "prepare")
      throw new Error("Unknown composer operation.");
    const parts = input.text === void 0 ? input.parts : replaceTextValue(input.parts, input.text);
    const prepared = input.images?.length ? [...parts, ...input.images.map((image) => ({ type: "image_url", image_url: { url: image.url, detail: image.detail } }))] : parts;
    return JSON.stringify({
      parts: prepared,
      hasMeaningfulContent: hasMeaningfulMessageContent([{ role: "user", content: prepared }]),
      text: textValueOf(prepared)
    });
  }

  // shared/google-sync/entry.ts
  var driveFolderName = (json) => JSON.stringify(defaultSyncFolderName(JSON.parse(json)));
  var driveListing = (json) => JSON.stringify({ parameters: driveListParameters(), suggestedName: nextSyncFolderName(DEFAULT_SYNC_FOLDER_NAME, JSON.parse(json)) });
  var driveHeaderID = (json) => JSON.stringify(encryptedSyncHeaderId(JSON.parse(json)));
  var global2 = globalThis;
  global2.crypto = { randomUUID: () => host("uuid") };
  global2.console = { error: () => {
  }, warn: () => {
  }, log: () => {
  } };
  global2.performance = { now: () => Date.now() };
  global2.structuredClone = (value) => JSON.parse(JSON.stringify(value));
  global2.TextEncoder = class {
    encode(value) {
      return new Uint8Array(host("utf8", value));
    }
  };
  global2.TextDecoder = class {
    decode(value) {
      return host("text", Array.from(value));
    }
  };
  var sequence = 0;
  var requests = [];
  var replies = /* @__PURE__ */ new Map();
  var request = (method, args) => new Promise((resolve, reject) => {
    const id = ++sequence;
    requests.push({ id, method, args });
    replies.set(id, { resolve, reject });
  });
  var drive = new Proxy({}, { get: (_target, method) => {
    if (method === "supportsCompaction")
      return true;
    if (method === "keyHeader")
      return (dataset) => request("metadata", [dataset]).then((file) => encryptedSyncHeaderId(file));
    if (method === "history")
      return async (dataset) => ({
        commits: await request("commits", [dataset]),
        packs: await request("packs", [dataset])
      });
    return (...args) => request(method, args.map((arg) => arg instanceof Uint8Array ? Array.from(arg) : arg)).then((value) => {
      if (method === "read")
        return new Uint8Array(value);
      if (method === "changes")
        return { ...value, changes: value.changes.map((change) => ({
          id: change.fileId,
          removed: change.removed || change.file?.trashed,
          dataset: change.file?.appProperties?.dataset,
          kind: change.file?.appProperties?.kind
        })) };
      return value;
    });
  } });
  var session;
  var outcome;
  var start = (operation, json) => {
    outcome = { status: "pending" };
    const args = JSON.parse(json);
    Promise.resolve().then(async () => {
      switch (operation) {
        case "create": {
          const created = await EncryptedSync.create(drive, args.password, args.options);
          session = created.session;
          return created.file;
        }
        case "open":
          session = new EncryptedSync(args.dataset, drive, args.options);
          return null;
        case "unlock":
          return session.unlock(args.password);
        case "restoreKey":
          return session.restoreKey();
        case "push":
          host("stageAccepted", session.dataset, args.snapshot);
          return session.push(args.snapshot, args.replace);
        case "synchronize":
          host("stageAccepted", session.dataset, args.snapshot);
          return session.synchronize(args.snapshot, args.replace);
        case "resolveForPublication":
          host("stageAccepted", session.dataset, args.snapshot);
          return session.resolve(args.snapshot, args.mode);
        case "pull":
          return session.pull();
        case "acceptLocal":
          host("stageAccepted", session.dataset, args.snapshot);
          return session.acceptLocal(args.snapshot);
        case "receive": {
          const snapshot = await session.pull();
          host("stageAccepted", session.dataset, snapshot);
          await session.acceptLocal(snapshot);
          return snapshot;
        }
        case "resolve": {
          host("stageAccepted", session.dataset, args.snapshot);
          const snapshot = await session.resolve(args.snapshot, args.mode);
          host("stageAccepted", session.dataset, snapshot);
          await session.acceptLocal(snapshot);
          return snapshot;
        }
        case "close":
          session.close();
          return null;
        default:
          throw new Error("Unknown sync operation");
      }
    }).then((value) => {
      outcome = { status: "done", value: value ?? null };
    }, (error2) => {
      outcome = { status: "error", error: String(error2.message ?? error2), conflictKeys: error2.keys };
    });
  };
  var drain = () => {
    const pending = requests;
    requests = [];
    return JSON.stringify(pending);
  };
  var settle = (id, json) => {
    const reply = replies.get(id);
    replies.delete(id);
    const result3 = JSON.parse(json);
    if (result3.ok)
      reply.resolve(result3.value);
    else
      reply.reject(result3.notFound ? new SyncFileNotFoundError(result3.error) : new Error(result3.error));
  };
  var result2 = () => JSON.stringify({ ...outcome, value: void 0, valueJSON: outcome.value === void 0 ? null : JSON.stringify(outcome.value) });
  var recordOutcome;
  var recordsStart = (operation, json) => {
    recordOutcome = {};
    const args = JSON.parse(json);
    Promise.resolve().then(() => {
      switch (operation) {
        case "toRecords":
          return toRecords(args[0]);
        case "fromRecords":
          return fromRecords(args[0]);
        case "canonical":
          return canonical(args[0]);
        case "resolveContent":
          return resolveStrict(args[0], args[1]);
        case "resolveProjectedContent":
          return resolveContent(args[0], args[1]);
        default:
          throw new Error("Unknown shared record operation");
      }
    }).then((value) => {
      recordOutcome = { valueJSON: JSON.stringify(value) };
    }, (error2) => {
      recordOutcome = { error: String(error2.message ?? error2) };
    });
  };
  var recordsResult = () => JSON.stringify(recordOutcome);
  return __toCommonJS(entry_exports);
})();

/* Dependency @babel/runtime
MIT License

Copyright (c) 2014-present Sebastian McKenzie and other contributors

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

*/
/* Dependency diff-match-patch

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright [yyyy] [name of copyright owner]

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/
/* Dependency i18next
The MIT License (MIT)

Copyright (c) 2022 i18next

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
/* Dependency lodash
Copyright OpenJS Foundation and other contributors <https://openjsf.org/>

Based on Underscore.js, copyright Jeremy Ashkenas,
DocumentCloud and Investigative Reporters & Editors <http://underscorejs.org/>

This software consists of voluntary contributions made by many
individuals. For exact contribution history, see the revision history
available at https://github.com/lodash/lodash

The following license applies to all parts of this software except as
documented below:

====

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

====

Copyright and related rights for sample code are waived via CC0. Sample
code is defined as all source code displayed within the prose of the
documentation.

CC0: http://creativecommons.org/publicdomain/zero/1.0/

====

Files located in the node_modules and vendor directories are externally
maintained libraries used by this software which have their own
licenses; we recommend you read them, as their terms may differ from the
terms above.

*/

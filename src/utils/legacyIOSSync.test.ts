import { describe, expect, it } from 'vitest';
import { LEGACY_IOS_GOOGLE_SOURCE, legacyIOSGoogleFile } from './legacyIOSSync';
import { fileImport } from '../../shared/google-sync/fileImport';

describe('readonly old iOS Google source', () => {
  it('keeps the old appData locator and newest-first selection in the shared bridge', () => {
    expect(JSON.parse(fileImport(JSON.stringify({operation:'legacyGoogleSource'})))).toEqual(LEGACY_IOS_GOOGLE_SOURCE);
    expect(LEGACY_IOS_GOOGLE_SOURCE.parameters).toMatchObject({spaces:'appDataFolder',orderBy:'modifiedTime desc',pageSize:'1',q:"name='weavelet-canvas-sync.wvlt' and trashed=false"});
    const data={files:[{id:'new',name:LEGACY_IOS_GOOGLE_SOURCE.filename},{id:'old',name:LEGACY_IOS_GOOGLE_SOURCE.filename}]};
    const before=JSON.stringify(data);
    expect(JSON.parse(fileImport(JSON.stringify({operation:'legacyGoogleFile',data})))).toBe('new');
    expect(JSON.stringify(data)).toBe(before);
    expect(legacyIOSGoogleFile({files:[]})).toBeNull();
  });
  it('rejects incomplete and malformed lists rather than importing another file', () => {
    for(const data of [null,[],{}, {files:[],incompleteSearch:true},{files:[],incompleteSearch:'false'},{files:[{id:'',name:LEGACY_IOS_GOOGLE_SOURCE.filename}]},{files:[{id:'other',name:'another.wvlt'}]}]) expect(()=>legacyIOSGoogleFile(data)).toThrow();
  });
});

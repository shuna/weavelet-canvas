import { describe, expect, it } from 'vitest';
import { composerContent } from '../../shared/google-sync/composer';
const prepare = (input: Record<string, unknown>) => JSON.parse(composerContent(JSON.stringify({operation:'prepare',...input})));
describe('shared composer actual Web rules', () => {
  it('changes only first text and keeps ordered parts and opaque metadata', () => {
    const parts = [{type:'image_url',image_url:{url:'data:fake',detail:'low'},x:{opaqueRef:1}},
      {type:'text',text:'first',x:{opaqueRef:2}}, {type:'text',text:'second'}];
    expect(prepare({parts}).parts).toEqual(parts);
    const result = prepare({parts,text:'replacement',images:[{url:'https://example.test/image',detail:'high'}]});
    expect(result).toEqual({parts:[parts[0], {...parts[1],text:'replacement'},parts[2],
      {type:'image_url',image_url:{url:'https://example.test/image',detail:'high'}}],hasMeaningfulContent:true,text:'replacement'});
    expect(parts[1].text).toBe('first');
  });
  it('accepts image-only, rejects empty, and uses actual text insertion rule', () => {
    expect(prepare({parts:[{type:'text',text:' \n'}]}).hasMeaningfulContent).toBe(false);
    const image = {type:'image_url',image_url:{url:'data:fake',detail:'auto'}};
    expect(prepare({parts:[],images:[image.image_url]})).toEqual({parts:[image],text:'',hasMeaningfulContent:true});
    expect(prepare({parts:[image],text:''}).parts).toEqual([{type:'text',text:''},image]);
  });
});

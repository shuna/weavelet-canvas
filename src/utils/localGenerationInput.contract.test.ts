import { describe, expect, it } from 'vitest';
import { localGenerationInput } from '../../shared/google-sync/localGeneration';
import { buildLocalChatMessages as actualWebMessages } from '../hooks/submitHelpers';
import { normalizeAssistantPrefill, createLocalGenerationInput } from './localGenerationInput';
import { _defaultChatConfig } from '../constants/chatDefaults';
import type { MessageInterface } from '../types/chat';
const config={..._defaultChatConfig,model:'fake-local',modelSource:'local' as const,systemPrompt:'system',xOpaque:{opaqueRef:1}};
describe('shared actual local generation input',()=>{
  it('matches actual Web ordered text conversion and local prefill normalization',()=>{
    const messages:MessageInterface[]=[{role:'user',content:[{type:'text',text:'first'},
      {type:'image_url',image_url:{url:'data:fake',detail:'auto'}},{type:'text',text:'second'},{type:'reasoning',text:'excluded'}]},
      {role:'assistant',content:[{type:'text',text:'answer'}]}];
    const result=JSON.parse(localGenerationInput(JSON.stringify({messages,config,assistantPrefill:' \n prefix \t'})));
    expect(result).toEqual({messages:[{role:'system',content:'system'},{role:'user',content:'first\nsecond'},{role:'assistant',content:'answer'}],config,assistantPrefix:'prefix',fallbackPrompt:'system: system\n\nuser: first\nsecond\n\nassistant: answer\n\nassistant:prefix',options:{maxTokens:4000,temperature:1}});
    expect(result.messages).toEqual(actualWebMessages(messages,'append',messages.length,config.model,undefined,config.systemPrompt));
    expect(createLocalGenerationInput(result.messages,config,normalizeAssistantPrefill(' \n prefix \t'))).toEqual({messages:result.messages,config,assistantPrefix:'prefix'});
  });
  it('keeps actual image-only empty text mapping, omission/target boundary, and empty-prefix absence',()=>{
    const messages:MessageInterface[]=[{role:'user',content:[{type:'image_url',image_url:{url:'data:fake',detail:'low'}}]},
      {role:'assistant',content:[{type:'text',text:'omit'}]}, {role:'user',content:[{type:'text',text:'outside request'}]}];
    const result=JSON.parse(localGenerationInput(JSON.stringify({messages,activePath:['one','two','three'],omittedNodes:{two:true},messageIndex:2,
      config:{...config,systemPrompt:''},assistantPrefill:' \n '})));
    expect(result.messages).toEqual([{role:'user',content:''}]);expect(result).not.toHaveProperty('assistantPrefix');
    expect(result.config.xOpaque).toEqual({opaqueRef:1});
  });
});

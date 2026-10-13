import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareRequestTransport } from './requestTransport';
import { getChatCompletion, getChatCompletionStream, prepareStreamRequest } from './api';
import { generationRequest } from '../../shared/google-sync/generation';
import { _defaultChatConfig } from '../constants/chatDefaults';
import useStore from '@store/store';
const config = {..._defaultChatConfig,model:'deployment'};
const messages = [{role:'user' as const,content:[{type:'text' as const,text:'question'}]}];
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('shared actual request transport',()=>{
  it('returns auth descriptors and exact Web Azure URL rules without secrets',()=>{
    const endpoint='https://FAKE.openai.azure.com/';
    const prepared=prepareRequestTransport(endpoint,config,true,{'X-Test':'fake'},'2024-test');
    expect(prepared).toEqual({endpoint:endpoint+'openai/deployments/deployment/chat/completions?api-version=2024-test',
      headers:{'Content-Type':'application/json','X-Test':'fake'},authentication:[{name:'Authorization',prefix:'Bearer '},{name:'api-key',prefix:''}]});
    expect(prepareRequestTransport(prepared.endpoint,config,true,undefined,'2024-test').endpoint).toBe(prepared.endpoint);
    expect(prepareRequestTransport(endpoint,config,false)).toMatchObject({endpoint,authentication:[]});
  });
  it('uses the common rules in all three actual Web completion callers',async()=>{
    vi.spyOn(useStore,'getState').mockReturnValue({providerCustomModels:{},favoriteModels:[],providerModelCache:{},proxyEnabled:false} as never);
    const fetch=vi.fn().mockResolvedValue({ok:true,status:200,headers:new Headers(),json:async()=>({choices:[]}),body:null});
    vi.stubGlobal('fetch',fetch);
    const endpoint='https://FAKE.openai.azure.com/';
    const prepared=prepareStreamRequest(endpoint,messages,config,'FAKE_TEST_KEY',{'X-Test':'fake'},'2024-test');
    await getChatCompletion(endpoint,messages,config,'FAKE_TEST_KEY',{'X-Test':'fake'},'2024-test');
    await getChatCompletionStream(endpoint,messages,config,'FAKE_TEST_KEY',{'X-Test':'fake'},'2024-test');
    expect(prepared.headers).toEqual({'Content-Type':'application/json','X-Test':'fake',Authorization:'Bearer FAKE_TEST_KEY','api-key':'FAKE_TEST_KEY'});
    for(const [url,request] of fetch.mock.calls){expect(url).toBe(prepared.endpoint);expect(request.headers).toEqual(prepared.headers);}
  });
  it('applies direct OpenRouter routing/sticky/prompt cache and rejects mismatched endpoints',()=>{
    const request={messages,config:{...config,model:'anthropic/claude-sonnet-4',providerId:'openrouter',systemPrompt:'prefix',openRouter:{
      routing:{only:['anthropic'],allow_fallbacks:false},stickySession:true,promptCache:{mode:'claude-system',ttl:'1h'},responseCache:{mode:'on'}}},
      modelState:{},transport:{endpoint:'https://openrouter.ai/api/v1/chat/completions',endpointURL:{protocol:'https:',hostname:'openrouter.ai'},hasApiKey:true,chatId:'chat-1'}};
    const result=JSON.parse(generationRequest(JSON.stringify(request)));
    expect(result.body).toMatchObject({provider:{only:['anthropic'],allow_fallbacks:false},session_id:'weavelet:chat-1'});
    expect(result.body.messages[0].content[0]).toMatchObject({text:'prefix',cache_control:{type:'ephemeral',ttl:'1h'}});
    expect(result.headers).toEqual({'Content-Type':'application/json'});
    expect(result.authentication).toEqual([{name:'Authorization',prefix:'Bearer '}]);
    expect(()=>generationRequest(JSON.stringify({...request,transport:{...request.transport,endpointURL:{protocol:'https:',hostname:'openrouter.ai.example.test'}}}))).toThrow();
  });
});

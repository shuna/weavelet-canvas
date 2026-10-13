import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ cache:vi.fn(), models:vi.fn(), loading:vi.fn(), fetch:vi.fn(), toast:vi.fn(), stateIndex:0,
  old:[{id:'retained',name:'retained',providerId:'openrouter'}] }));
vi.mock('react',()=>({useCallback:(fn:unknown)=>fn,useEffect:()=>{},useState:(initial:any)=>[
  typeof initial==='function'?initial():initial,mocks.stateIndex++===0?mocks.models:mocks.loading]}));
vi.mock('@store/store',()=>({default:(selector:any)=>selector({providerModelCache:{openrouter:mocks.old},setProviderModelCache:mocks.cache})}));
vi.mock('@api/providerModels',()=>({fetchProviderModels:mocks.fetch}));
vi.mock('@utils/showToast',()=>({showToast:mocks.toast}));
import { useProviderModels } from './providerMenuHelpers';
import type { ProviderConfig, ProviderId } from '@type/provider';
const provider:ProviderConfig={id:'openrouter',name:'fake',endpoint:'https://example.test/chat',modelsRequireAuth:false};
describe('actual provider menu cache publication',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.stateIndex=0;});
  it.each(['load','refresh'] as const)('%s preserves old cache and reports fetch failure',async kind=>{
    mocks.fetch.mockRejectedValueOnce(new Error('fake failure'));
    const hook=useProviderModels({openrouter:provider} as Record<ProviderId,ProviderConfig>);
    if(kind==='load')await hook.loadModels('openrouter',true);else await hook.refreshModels('openrouter',provider);
    expect(mocks.cache).not.toHaveBeenCalled();expect(mocks.models).not.toHaveBeenCalled();
    expect(hook.models.openrouter).toBe(mocks.old);expect(mocks.toast).toHaveBeenCalledOnce();
    expect(mocks.loading).toHaveBeenCalledTimes(2);
  });
  it('skips cache publication and error toast when no request was possible',async()=>{
    mocks.fetch.mockResolvedValueOnce(null);
    await useProviderModels({openrouter:provider} as Record<ProviderId,ProviderConfig>).refreshModels('openrouter',provider);
    expect(mocks.cache).not.toHaveBeenCalled();expect(mocks.models).not.toHaveBeenCalled();expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('publishes a successful empty list',async()=>{
    mocks.fetch.mockResolvedValueOnce([]);
    await useProviderModels({openrouter:provider} as Record<ProviderId,ProviderConfig>).refreshModels('openrouter',provider);
    expect(mocks.cache).toHaveBeenCalledWith('openrouter',[]);expect(mocks.models).toHaveBeenCalledOnce();expect(mocks.toast).not.toHaveBeenCalled();
  });
});

// Native's raw boundary wraps only fields the Web import converters copy opaquely.
// Validation, repair and format detection remain in the actual import core.
export type ImportOpaquePath=(string|number)[];
export function importOpaquePaths(data:unknown):ImportOpaquePath[]{
 const paths:ImportOpaquePath[]=[];
 const object=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
 const fields=(v:any,p:ImportOpaquePath,known:string[])=>{if(object(v))for(const key of Object.keys(v))if(!known.includes(key))paths.push([...p,key]);};
 const parts=(v:any,p:ImportOpaquePath)=>{if(!Array.isArray(v))return;v.forEach((part,index)=>{
  const at=[...p,index];if(!object(part))return;
  const known=part.type==='text'||part.type==='reasoning'?['type','text']:part.type==='image_url'?['type','image_url']:part.type==='tool_call'?['type','id','name','arguments']:part.type==='tool_result'?['type','tool_call_id','content']:['type'];
  fields(part,at,known);if(part.type==='image_url')fields(part.image_url,[...at,'image_url'],['url','detail']);
 });};
 const message=(v:any,p:ImportOpaquePath)=>{fields(v,p,['role','content']);if(object(v))parts(v.content,[...p,'content']);};
 const node=(v:any,p:ImportOpaquePath)=>{fields(v,p,['id','parentId','role','contentHash','content']);if(object(v))parts(v.content,[...p,'content']);};
 const tree=(v:any,p:ImportOpaquePath,extra:string[]=[])=>{fields(v,p,['nodes','rootId','activePath','messageAttributesV1',...extra]);if(object(v?.nodes))for(const [id,n]of Object.entries(v.nodes))node(n,[...p,'nodes',id]);
  if(object(v?.messageAttributesV1?.byNode))for(const [id,attrs]of Object.entries(v.messageAttributesV1.byNode))fields(attrs,[...p,'messageAttributesV1','byNode',id],[]);
 };
 const chat=(v:any,p:ImportOpaquePath)=>{
  fields(v,p,['id','title','titleSet','folder','config','messages','branchTree','collapsedNodes','omittedNodes','protectedNodes','summaryTargets','summaries']);
  if(!object(v))return;fields(v.config,[...p,'config'],['model','systemPrompt','temperature','presence_penalty','top_p','frequency_penalty']);
  if(Array.isArray(v.messages))v.messages.forEach((m:any,index:number)=>message(m,[...p,'messages',index]));tree(v.branchTree,[...p,'branchTree']);
  if(Array.isArray(v.summaries))v.summaries.forEach((s:any,index:number)=>{const at=[...p,'summaries',index];fields(s,at,['id','mode','text','useForSubmit','format','sources','generation']);
   if(Array.isArray(s?.sources))s.sources.forEach((item:any,i:number)=>fields(item,[...at,'sources',i],['nodeId','parentId','role','textParts']));
   fields(s?.generation,[...at,'generation'],['model','providerId','settings','createdAt']);if(object(s?.generation?.settings))fields(s.generation.settings,[...at,'generation','settings'],[]);
  });
 };
 const openAI=(v:any,p:ImportOpaquePath)=>{
  fields(v,p,['title','mapping','current_node','messages','model','temperature','max_tokens','top_p','frequency_penalty','presence_penalty']);
  if(Array.isArray(v?.messages))v.messages.forEach((m:any,i:number)=>message(m,[...p,'messages',i]));
  if(object(v?.mapping))for(const [id,n]of Object.entries(v.mapping) as [string,any][]){const at=[...p,'mapping',id];fields(n,at,['id','parent','children','message']);fields(n?.message,[...at,'message'],['author','content']);fields(n?.message?.author,[...at,'message','author'],['role']);
   const content=n?.message?.content;if(object(content)&&Object.hasOwn(content,'parts'))fields(content,[...at,'message','content'],['parts']);else if(object(content)){const offset=paths.length;parts([content],[...at,'message','content']);for(let i=offset;i<paths.length;i++)paths[i].splice(at.length+2,1);}
  }
 };
 const root=(v:any,p:ImportOpaquePath)=>{
  if(Array.isArray(v)){v.forEach((item,index)=>object(item?.mapping)?openAI(item,[...p,index]):chat(item,[...p,index]));return;}
  if(!object(v))return;
  if(object(v.state)){fields(v,p,['version','state']);root(v.state,[...p,'state']);return;}
  if(Array.isArray(v.chats)||object(v.contentStore)||object(v.folders)){
   fields(v,p,['version','chats','folders','contentStore','evaluationSettings','evaluationResults','recoveredContentCount','unavailableContent','extensions','branchClipboard']);
   v.chats?.forEach((c:any,i:number)=>chat(c,[...p,'chats',i]));
   if(object(v.contentStore))for(const [hash,e]of Object.entries(v.contentStore) as [string,any][]){fields(e,[...p,'contentStore',hash],['content','refCount','delta']);parts(e?.content,[...p,'contentStore',hash,'content']);fields(e?.delta,[...p,'contentStore',hash,'delta'],['baseHash','patch']);}
   if(object(v.folders))for(const [id,f]of Object.entries(v.folders))fields(f,[...p,'folders',id],['id','name','order','expanded','parentId']);
   fields(v.evaluationSettings,[...p,'evaluationSettings'],['safetyPreSend','safetyPostReceive','qualityPreSend','qualityPostReceive']);
   if(object(v.evaluationResults))for(const [id,r]of Object.entries(v.evaluationResults))fields(r,[...p,'evaluationResults',id],['phase']);
   if(object(v.extensions))fields(v.extensions,[...p,'extensions'],[]);
   const clip=v.branchClipboard;if(object(clip)){fields(clip,[...p,'branchClipboard'],['nodes','nodeIds','sourceChat','messageAttributesV1','collapsedNodes','omittedNodes','protectedNodes']);tree(clip,[...p,'branchClipboard'],['nodeIds','sourceChat','collapsedNodes','omittedNodes','protectedNodes']);}
  }else if(object(v.mapping)||(Array.isArray(v.messages)&&typeof v.model==='string'))openAI(v,p);else chat(v,p);
 };
 root(data,[]);return paths;
}

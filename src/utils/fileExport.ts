import type { ExportV3 } from '../types/export';
import { buildExportContentStore } from './contentStore';
import { prepareChatForExport,chatToOpenAIFormat,chatToOpenRouterFormat,chatToLMStudioFormat } from './chatExport';
import {chatToMarkdown} from './chatMarkdown';
import {switchActivePathState} from '../store/branch-domain';
export type FileExportFormat = 'v3'|'v1'|'openai'|'openrouter'|'lmstudio'|'markdown';
export type FileExportRequest = {v3:ExportV3;scope:'all'|'chat';format:FileExportFormat;chatId?:string;visibleBranchOnly?:boolean;visiblePath?:string[]};
export function buildFileExportPayload(input:FileExportRequest):object|string {
 const {v3,scope,format}=input;
 if(v3.version!==3)throw new Error('Unsupported export source.');
 if(format==='openrouter'&&input.visibleBranchOnly)throw new Error('OpenRouter export uses the current branch; a separate branch scope is unsupported.');
 const store=v3.contentStore;
 if(scope==='all'){
  switch(format){
   case 'v3':return {...v3,contentStore:buildExportContentStore(store)};
   case 'v1':return {chats:v3.chats?.map(chat=>{const expanded={...chat};if(expanded.branchTree)expanded.messages=prepareChatForExport(chat,store).chat.messages;const {branchTree,collapsedNodes,...rest}=expanded;return rest;}),folders:v3.folders,version:1};
   case 'openai':return v3.chats?.map(chat=>chatToOpenAIFormat(chat,store))??[];
   case 'openrouter':return v3.chats?.map(chat=>chatToOpenRouterFormat(chat,store))??[];
   case 'lmstudio':return v3.chats?.map(chat=>chatToLMStudioFormat(chat,store))??[];
   default:throw new Error('Unsupported all-chat export format.');
  }
 }
 if(scope!=='chat')throw new Error('Invalid export scope.');
 let chat=v3.chats?.find(chat=>chat.id===input.chatId);
 if(!chat)throw new Error('Export chat is missing.');
 if(input.visiblePath&&chat.branchTree){
  if(input.visiblePath.some(id=>!Object.hasOwn(chat!.branchTree!.nodes,id)))throw new Error('Invalid export viewing path.');
  chat=switchActivePathState([chat],0,input.visiblePath,store)[0];
 }
 const options={visibleBranchOnly:input.visibleBranchOnly};
 switch(format){
  case 'v3':{
   const prepared=prepareChatForExport(chat,store,options),exportedChat={...prepared.chat};delete exportedChat.folder;
   return {chats:[exportedChat],contentStore:prepared.contentStore,folders:{},evaluationSettings:v3.evaluationSettings,
    evaluationResults:Object.fromEntries(Object.entries(v3.evaluationResults??{}).filter(([key])=>key.startsWith(`${chat!.id}:`))),version:3};
  }
  case 'openai':return [chatToOpenAIFormat(chat,store,options)];
  case 'openrouter':return chatToOpenRouterFormat(chat,store);
  case 'lmstudio':return chatToLMStudioFormat(chat,store,options);
  case 'markdown':return chatToMarkdown(input.visibleBranchOnly?prepareChatForExport(chat,store,options).chat:chat);
  default:throw new Error('Unsupported single-chat export format.');
 }
}

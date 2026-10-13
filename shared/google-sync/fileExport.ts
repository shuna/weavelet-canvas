import {diffJSONChanges} from '../../src/utils/jsonChanges';
import {buildFileExportPayload,type FileExportRequest} from '../../src/utils/fileExport';
export function fileExport(json:string):string {
 const input=JSON.parse(json) as FileExportRequest;
 const payload=buildFileExportPayload(input);
 return JSON.stringify({payload,...(input.scope==='all'&&input.format==='v3'?{payloadChanges:diffJSONChanges(input.v3,JSON.parse(JSON.stringify(payload)))}:{}),mimeType:input.format==='markdown'?'text/markdown':'application/json',extension:input.format==='markdown'?'md':'json'});
}

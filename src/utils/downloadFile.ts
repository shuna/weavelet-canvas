const downloadFile = (data: object, filename: string) => {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const downloadFileGzip = async (data: object, filename: string) => {
  if (typeof CompressionStream === 'undefined') {
    downloadFile(data, filename);
    return;
  }
  const blob = new Blob([JSON.stringify(data)]);
  const cs = new CompressionStream('gzip');
  const compressedStream = blob.stream().pipeThrough(cs);
  const compressedBlob = await new Response(compressedStream).blob();
  const url = URL.createObjectURL(compressedBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.json.gz`;
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export default downloadFile;

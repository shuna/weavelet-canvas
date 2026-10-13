export { formatNumber } from './chatSize';

// Function to convert HTML to an image using html2canvas
export const htmlToImg = async (html: HTMLDivElement) => {
  const needResize = window.innerWidth >= 1024;
  const initialWidth = html.style.width;
  const initialHeight = html.style.height;
  const initialPosition = html.style.position;

  if (needResize) {
    html.style.width = '1023px';
  }

  // Apply print styles temporarily
  html.classList.add('print-mode');

  // Force layout reflow
  html.offsetHeight;

  // Temporarily set position to absolute
  html.style.position = 'absolute';

  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(html);

  // Revert styles
  if (needResize) {
    html.style.width = initialWidth;
    html.style.height = initialHeight;
  }
  html.style.position = initialPosition;
  html.classList.remove('print-mode');
  const dataURL = canvas.toDataURL('image/png');
  return dataURL;
};

// Function to download the image as a file
export const downloadImg = (imgData: string, fileName: string) => {
  const link = document.createElement('a');
  link.href = imgData;
  link.download = fileName;
  link.click();
  link.remove();
};

export { chatToMarkdown, hasUnclosedCodeBlock } from './chatMarkdown';

// Function to download the markdown content as a file
export const downloadMarkdown = (markdown: string, fileName: string) => {
  const link = document.createElement('a');
  const markdownFile = new Blob([markdown], { type: 'text/markdown' });
  link.href = URL.createObjectURL(markdownFile);
  link.download = fileName;
  link.click();
  link.remove();
};

export { preprocessLaTeX } from './markdown';

import React from 'react';

const RefreshNextIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      stroke='currentColor'
      fill='none'
      strokeWidth='1.5'
      viewBox='0 0 24 24'
      strokeLinecap='round'
      strokeLinejoin='round'
      className='h-3 w-3'
      height='1em'
      width='1em'
      xmlns='http://www.w3.org/2000/svg'
      {...props}
    >
      <polyline points='1 4 1 10 7 10'></polyline>
      <path d='M3.51 15a9 9 0 0 0 15.13 3.36L21 16'></path>
      <path d='M1 10l4.64-4.36A9 9 0 0 1 20.49 9'></path>
      <line x1='17' y1='13' x2='17' y2='19'></line>
      <polyline points='14 16 17 19 20 16'></polyline>
    </svg>
  );
};

export default RefreshNextIcon;

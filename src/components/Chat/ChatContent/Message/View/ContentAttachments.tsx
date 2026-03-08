import { useState } from 'react';

import { ImageContentInterface } from '@type/chat';

import PopupModal from '@components/PopupModal';

export default function ContentAttachments({
  images,
}: {
  images: ImageContentInterface[];
}) {
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  if (images.length === 0) return null;

  return (
    <>
      <div className='flex gap-4'>
        {images.map((image, index) => (
          <div key={index} className='image-container'>
            <img
              src={image.image_url.url}
              alt={`uploaded-${index}`}
              className='h-20 cursor-pointer'
              onClick={() => setZoomedImage(image.image_url.url)}
            />
          </div>
        ))}
      </div>
      {zoomedImage && (
        <PopupModal
          title=''
          setIsModalOpen={() => setZoomedImage(null)}
          handleConfirm={() => setZoomedImage(null)}
          cancelButton={false}
        >
          <div className='flex justify-center'>
            <img
              src={zoomedImage}
              alt='Zoomed'
              className='max-w-full max-h-full'
            />
          </div>
        </PopupModal>
      )}
    </>
  );
}

import React from 'react';

import RefreshNextIcon from '@icon/RefreshNextIcon';

import BaseButton from './BaseButton';

const RegenerateNextButton = ({
  onClick,
}: {
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}) => {
  return (
    <BaseButton
      icon={<RefreshNextIcon />}
      buttonProps={{ 'aria-label': 'regenerate next message only' }}
      onClick={onClick}
    />
  );
};

export default RegenerateNextButton;

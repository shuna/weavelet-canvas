import React from 'react';
import { EdgeProps, SmoothStepEdge, useStore } from 'reactflow';

const BranchStepEdge = (props: EdgeProps) => {
  const zoom = useStore(state => state.transform[2]);
  return (
    <SmoothStepEdge
      {...props}
      pathOptions={{ borderRadius: 32 }}
      style={{ ...props.style, strokeWidth: Number(props.style?.strokeWidth ?? 1) / Math.min(zoom, 1) }}
    />
  );
};

export default BranchStepEdge;

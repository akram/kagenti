// Copyright 2025 IBM Corp.
// Licensed under the Apache License, Version 2.0

import React from 'react';
import { Label } from '@patternfly/react-core';

type PhaseColor = 'green' | 'red' | 'blue' | 'cyan';

export const BuildPhaseBadge: React.FC<{
  phase: 'Pending' | 'Running' | 'Succeeded' | 'Failed' | string;
}> = ({ phase }) => {
  let color: PhaseColor = 'red';
  if (phase === 'Succeeded') color = 'green';
  else if (phase === 'Running' || phase === 'Pending') color = 'blue';
  return <Label color={color}>{phase}</Label>;
};

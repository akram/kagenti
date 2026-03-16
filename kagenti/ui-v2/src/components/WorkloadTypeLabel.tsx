// Copyright 2025 IBM Corp.
// Licensed under the Apache License, Version 2.0

import React from 'react';
import { Label } from '@patternfly/react-core';
type Color = 'grey' | 'orange' | 'gold';

const COLORS: Record<string, Color> = {
  deployment: 'grey',
  statefulset: 'gold',
  job: 'orange',
};

export const WorkloadTypeLabel: React.FC<{
  workloadType?: string;
}> = ({ workloadType }) => {
  const type = (workloadType || 'deployment').toLowerCase();
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  const color = COLORS[type] ?? 'grey';
  return (
    <Label color={color} isCompact>
      {label}
    </Label>
  );
};

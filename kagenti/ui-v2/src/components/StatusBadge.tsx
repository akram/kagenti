// Copyright 2025 IBM Corp.
// Licensed under the Apache License, Version 2.0

import React from 'react';
import { Label } from '@patternfly/react-core';

type StatusColor = 'green' | 'red' | 'blue' | 'cyan' | 'orange';

const STATUS_COLORS: Record<string, StatusColor> = {
  Ready: 'green',
  Completed: 'green',
  Running: 'green',
  'Not Ready': 'red',
  Failed: 'red',
  Progressing: 'blue',
  Pending: 'cyan',
};

export const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const color = STATUS_COLORS[status] ?? 'orange';
  return <Label color={color}>{status}</Label>;
};

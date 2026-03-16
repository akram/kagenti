// Copyright 2025 IBM Corp.
// Licensed under the Apache License, Version 2.0

import React from 'react';
import { PageSection, Title, Text } from '@patternfly/react-core';

export interface CatalogSectionProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export const CatalogSection: React.FC<CatalogSectionProps> = ({
  title,
  description,
  children,
}) => (
  <PageSection>
    <Title headingLevel="h2" className="pf-v5-u-mb-md">
      {title}
    </Title>
    <Text component="p" className="pf-v5-u-mb-md">
      {description}
    </Text>
    {children}
  </PageSection>
);

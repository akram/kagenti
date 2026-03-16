// Copyright 2025 IBM Corp.
// Licensed under the Apache License, Version 2.0

import React from 'react';
import {
  PageSection,
  Title,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  Button,
} from '@patternfly/react-core';
import { NamespaceSelector } from '@/components/NamespaceSelector';

export interface CatalogPageLayoutProps {
  title: string;
  namespace: string;
  onNamespaceChange: (ns: string) => void;
  primaryButtonLabel: string;
  primaryButtonIcon: React.ReactNode;
  onPrimaryAction: () => void;
  children: React.ReactNode;
}

export const CatalogPageLayout: React.FC<CatalogPageLayoutProps> = ({
  title,
  namespace,
  onNamespaceChange,
  primaryButtonLabel,
  primaryButtonIcon,
  onPrimaryAction,
  children,
}) => (
  <>
    <PageSection variant="light">
      <Title headingLevel="h1">{title}</Title>
    </PageSection>

    <PageSection variant="light" padding={{ default: 'noPadding' }}>
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <NamespaceSelector
              namespace={namespace}
              onNamespaceChange={onNamespaceChange}
            />
          </ToolbarItem>
          <ToolbarItem>
            <Button
              variant="primary"
              icon={primaryButtonIcon}
              onClick={onPrimaryAction}
            >
              {primaryButtonLabel}
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
    </PageSection>

    {children}
  </>
);

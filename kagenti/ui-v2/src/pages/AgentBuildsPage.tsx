// Copyright 2025 IBM Corp.
// Licensed under the Apache License, Version 2.0

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Spinner,
  EmptyState,
  EmptyStateHeader,
  EmptyStateIcon,
  EmptyStateBody,
  Flex,
} from '@patternfly/react-core';
import { CubesIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { shipwrightService, type AgentBuildSummary } from '@/services/api';
import {
  CatalogPageLayout,
  CatalogSection,
  BuildCard,
} from '@/components';

export const AgentBuildsPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [namespace, setNamespace] = useState<string>('team1');
  const [expandedBuilds, setExpandedBuilds] = useState<Set<string>>(new Set());

  const {
    data: builds = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['agentBuilds', namespace],
    queryFn: () => shipwrightService.listAgentBuilds(namespace),
    enabled: !!namespace,
  });

  const retryBuildMutation = useMutation({
    mutationFn: ({ namespace: ns, buildName }: { namespace: string; buildName: string }) =>
      shipwrightService.triggerBuildRun(ns, buildName),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agentBuilds', variables.namespace] });
    },
  });

  const toggleBuildExpanded = (buildKey: string) => {
    setExpandedBuilds((prev) => {
      const next = new Set(prev);
      if (next.has(buildKey)) next.delete(buildKey);
      else next.add(buildKey);
      return next;
    });
  };

  return (
    <CatalogPageLayout
      title="Agent Builds"
      namespace={namespace}
      onNamespaceChange={setNamespace}
      primaryButtonLabel="Import Agent"
      primaryButtonIcon={<PlusCircleIcon />}
      onPrimaryAction={() => navigate('/agents/import')}
    >
      <CatalogSection
        title="Agent builds"
        description="All Shipwright builds in this namespace. Use this to see in-progress or failed builds and to rerun or open build details."
      >
        {isLoading ? (
          <div className="kagenti-loading-center">
            <Spinner size="lg" aria-label="Loading builds" />
          </div>
        ) : isError ? (
          <EmptyState>
            <EmptyStateHeader
              titleText="Error loading builds"
              icon={<EmptyStateIcon icon={CubesIcon} />}
              headingLevel="h4"
            />
            <EmptyStateBody>
              {error instanceof Error
                ? error.message
                : 'Unable to fetch agent builds.'}
            </EmptyStateBody>
          </EmptyState>
        ) : builds.length === 0 ? (
          <EmptyState>
            <EmptyStateHeader
              titleText="No agent builds"
              icon={<EmptyStateIcon icon={CubesIcon} />}
              headingLevel="h4"
            />
            <EmptyStateBody>
              No Shipwright builds in namespace &quot;{namespace}&quot;. Builds appear here after you import an agent from source.
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Flex direction={{ default: 'column' }} gap={{ default: 'gapMd' }}>
            {builds.map((build: AgentBuildSummary) => {
              const buildKey = `${build.namespace}/${build.buildName}`;
              return (
                <BuildCard
                  key={buildKey}
                  buildKey={buildKey}
                  buildName={build.buildName}
                  namespace={build.namespace}
                  gitUrl={build.gitUrl}
                  gitRevision={build.gitRevision}
                  buildRuns={build.buildRuns}
                  viewBuildHref={`/agents/${build.namespace}/${build.buildName}/build`}
                  isExpanded={expandedBuilds.has(buildKey)}
                  onToggleExpand={() => toggleBuildExpanded(buildKey)}
                  onRerun={() =>
                    retryBuildMutation.mutate({
                      namespace: build.namespace,
                      buildName: build.buildName,
                    })
                  }
                  isRerunPending={retryBuildMutation.isPending}
                />
              );
            })}
          </Flex>
        )}
      </CatalogSection>
    </CatalogPageLayout>
  );
};

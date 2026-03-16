// Copyright 2025 IBM Corp.
// Licensed under the Apache License, Version 2.0

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardBody,
  Flex,
  FlexItem,
  Text,
  ExpandableSection,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { BuildPhaseBadge } from '@/components/BuildPhaseBadge';

export interface BuildRunRow {
  name: string;
  phase: string;
  startTime?: string;
  completionTime?: string;
  failureMessage?: string;
}

export interface BuildCardProps {
  buildKey: string;
  buildName: string;
  namespace: string;
  gitUrl: string;
  gitRevision: string;
  buildRuns: BuildRunRow[];
  viewBuildHref: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onRerun: () => void;
  isRerunPending: boolean;
}

export const BuildCard: React.FC<BuildCardProps> = ({
  buildKey,
  buildName,
  gitUrl,
  gitRevision,
  buildRuns,
  viewBuildHref,
  isExpanded,
  onToggleExpand,
  onRerun,
  isRerunPending,
}) => {
  const navigate = useNavigate();
  const latestPhase =
    buildRuns.length > 0 ? buildRuns[0].phase : null;

  return (
    <Card key={buildKey} isCompact>
      <CardHeader
        actions={{
          actions: (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(viewBuildHref)}
              >
                View build
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={onRerun}
                isDisabled={isRerunPending}
              >
                {isRerunPending ? 'Rerunning…' : 'Rerun build'}
              </Button>
            </>
          ),
        }}
      >
        <CardTitle>
          <Button
            variant="link"
            isInline
            onClick={() => navigate(viewBuildHref)}
          >
            {buildName}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardBody>
        <Flex
          direction={{ default: 'row' }}
          gap={{ default: 'gapMd' }}
          flexWrap={{ default: 'wrap' }}
        >
          <FlexItem>
            <Text component="small">
              <strong>Git:</strong> {gitUrl} @ {gitRevision}
            </Text>
          </FlexItem>
          {latestPhase && (
            <FlexItem>
              <BuildPhaseBadge phase={latestPhase} />
            </FlexItem>
          )}
        </Flex>
        {buildRuns.length > 0 && (
          <ExpandableSection
            toggleText={`Build runs (${buildRuns.length})`}
            onToggle={onToggleExpand}
            isExpanded={isExpanded}
            className="pf-v5-u-mt-md"
          >
            <Table
              aria-label={`Build runs for ${buildName}`}
              variant="compact"
            >
              <Thead>
                <Tr>
                  <Th>Run</Th>
                  <Th>Phase</Th>
                  <Th>Started</Th>
                  <Th>Completed</Th>
                  <Th>Message</Th>
                </Tr>
              </Thead>
              <Tbody>
                {buildRuns.map((br) => (
                  <Tr key={br.name}>
                    <Td dataLabel="Run">{br.name}</Td>
                    <Td dataLabel="Phase">
                      <BuildPhaseBadge phase={br.phase} />
                    </Td>
                    <Td dataLabel="Started">{br.startTime ?? '—'}</Td>
                    <Td dataLabel="Completed">{br.completionTime ?? '—'}</Td>
                    <Td dataLabel="Message">{br.failureMessage ?? '—'}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </ExpandableSection>
        )}
      </CardBody>
    </Card>
  );
};

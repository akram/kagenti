// Copyright 2025 IBM Corp.
// Licensed under the Apache License, Version 2.0

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Spinner,
  EmptyState,
  EmptyStateHeader,
  EmptyStateIcon,
  EmptyStateBody,
  EmptyStateFooter,
  EmptyStateActions,
  Label,
  LabelGroup,
  Dropdown,
  DropdownList,
  DropdownItem,
  MenuToggle,
  MenuToggleElement,
  Icon,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { CubesIcon, PlusCircleIcon, EllipsisVIcon, ExclamationTriangleIcon } from '@patternfly/react-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Agent } from '@/types';
import { agentService } from '@/services/api';
import {
  CatalogPageLayout,
  CatalogSection,
  StatusBadge,
  WorkloadTypeLabel,
  DeleteConfirmModal,
} from '@/components';

export const AgentCatalogPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [namespace, setNamespace] = useState<string>('team1');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<Agent | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const {
    data: agents = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['agents', namespace],
    queryFn: () => agentService.list(namespace),
    enabled: !!namespace,
  });

  const deleteMutation = useMutation({
    mutationFn: ({ namespace: ns, name }: { namespace: string; name: string }) =>
      agentService.delete(ns, name),
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<Agent[]>(
        ['agents', variables.namespace],
        (old) => old?.filter((a) => a.name !== variables.name) ?? []
      );
      queryClient.invalidateQueries({ queryKey: ['agents', variables.namespace] });
      handleCloseDeleteModal();
    },
  });

  const handleDeleteClick = (agent: Agent) => {
    setAgentToDelete(agent);
    setDeleteModalOpen(true);
    setOpenMenuId(null);
  };

  const handleCloseDeleteModal = () => {
    setDeleteModalOpen(false);
    setAgentToDelete(null);
    setDeleteConfirmText('');
  };

  const handleDeleteConfirm = () => {
    if (agentToDelete && deleteConfirmText === agentToDelete.name) {
      deleteMutation.mutate({
        namespace: agentToDelete.namespace,
        name: agentToDelete.name,
      });
    }
  };

  const columns = ['Name', 'Description', 'Status', 'Labels', 'Workload', ''];

  const renderLabels = (agent: Agent) => {
    const labels = [];
    if (agent.labels.protocol) {
      agent.labels.protocol.forEach((p) => {
        labels.push(
          <Label key={`protocol-${p}`} color="blue" isCompact>
            {p.toUpperCase()}
          </Label>
        );
      });
    }
    if (agent.labels.framework) {
      labels.push(
        <Label key="framework" color="purple" isCompact>
          {agent.labels.framework}
        </Label>
      );
    }
    return <LabelGroup>{labels}</LabelGroup>;
  };

  const getMenuId = (agent: Agent) => `${agent.namespace}-${agent.name}`;

  return (
    <>
      <CatalogPageLayout
        title="Agent Catalog"
        namespace={namespace}
        onNamespaceChange={setNamespace}
        primaryButtonLabel="Import Agent"
        primaryButtonIcon={<PlusCircleIcon />}
        onPrimaryAction={() => navigate('/agents/import')}
      >
        <CatalogSection
          title="Built agents"
          description="Agents that have a workload from a successful build (Deployment, StatefulSet, or Job)."
        >
          {isLoading ? (
            <div className="kagenti-loading-center">
              <Spinner size="lg" aria-label="Loading agents" />
            </div>
          ) : isError ? (
            <EmptyState>
              <EmptyStateHeader
                titleText="Error loading agents"
                icon={<EmptyStateIcon icon={CubesIcon} />}
                headingLevel="h4"
              />
              <EmptyStateBody>
                {error instanceof Error
                  ? error.message
                  : 'Unable to fetch agents from the cluster.'}
              </EmptyStateBody>
            </EmptyState>
          ) : agents.length === 0 ? (
            <EmptyState>
              <EmptyStateHeader
                titleText="No built agents"
                icon={<EmptyStateIcon icon={CubesIcon} />}
                headingLevel="h4"
              />
              <EmptyStateBody>
                No built agents in namespace &quot;{namespace}&quot;. Import an agent from source to build and deploy.
              </EmptyStateBody>
              <EmptyStateFooter>
                <EmptyStateActions>
                  <Button variant="primary" onClick={() => navigate('/agents/import')}>
                    Import Agent
                  </Button>
                </EmptyStateActions>
              </EmptyStateFooter>
            </EmptyState>
          ) : (
            <Table aria-label="Built agents table" variant="compact">
              <Thead>
                <Tr>
                  {columns.map((col, idx) => (
                    <Th key={col || `col-${idx}`}>{col}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {agents.map((agent) => {
                  const menuId = getMenuId(agent);
                  return (
                    <Tr key={menuId}>
                      <Td dataLabel="Name">
                        <Button
                          variant="link"
                          isInline
                          onClick={() =>
                            navigate(`/agents/${agent.namespace}/${agent.name}`)
                          }
                        >
                          {agent.name}
                        </Button>
                      </Td>
                      <Td dataLabel="Description">
                        {agent.description || 'No description'}
                      </Td>
                      <Td dataLabel="Status">
                        <StatusBadge status={agent.status} />
                      </Td>
                      <Td dataLabel="Labels">{renderLabels(agent)}</Td>
                      <Td dataLabel="Workload">
                        <WorkloadTypeLabel workloadType={agent.workloadType} />
                      </Td>
                      <Td isActionCell>
                        <Dropdown
                          isOpen={openMenuId === menuId}
                          onSelect={() => setOpenMenuId(null)}
                          onOpenChange={(isOpen) => setOpenMenuId(isOpen ? menuId : null)}
                          toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                            <MenuToggle
                              ref={toggleRef}
                              aria-label="Actions menu"
                              variant="plain"
                              onClick={() =>
                                setOpenMenuId(openMenuId === menuId ? null : menuId)
                              }
                              isExpanded={openMenuId === menuId}
                            >
                              <EllipsisVIcon />
                            </MenuToggle>
                          )}
                          popperProps={{ position: 'right' }}
                        >
                          <DropdownList>
                            <DropdownItem
                              key="view"
                              onClick={() =>
                                navigate(`/agents/${agent.namespace}/${agent.name}`)
                              }
                            >
                              View details
                            </DropdownItem>
                            <DropdownItem
                              key="delete"
                              onClick={() => handleDeleteClick(agent)}
                              isDanger
                            >
                              Delete agent
                            </DropdownItem>
                          </DropdownList>
                        </Dropdown>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </CatalogSection>
      </CatalogPageLayout>

      <DeleteConfirmModal
        isOpen={deleteModalOpen}
        onClose={handleCloseDeleteModal}
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
        title="Delete agent?"
        bodyMessage={
          <>
            <Icon status="warning" style={{ marginRight: '8px' }}>
              <ExclamationTriangleIcon />
            </Icon>
            The agent <strong>{agentToDelete?.name}</strong> will be permanently
            deleted. This will also delete the associated Deployment, Service,
            and any Shipwright builds if they exist.
          </>
        }
        confirmName={agentToDelete?.name ?? ''}
        confirmValue={deleteConfirmText}
        onConfirmValueChange={setDeleteConfirmText}
        confirmInputAriaLabel="Confirm agent name"
      />
    </>
  );
};

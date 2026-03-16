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
import {
  ToolboxIcon,
  PlusCircleIcon,
  EllipsisVIcon,
  ExclamationTriangleIcon,
} from '@patternfly/react-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { Tool } from '@/types';
import { toolService } from '@/services/api';
import {
  CatalogPageLayout,
  CatalogSection,
  StatusBadge,
  WorkloadTypeLabel,
  DeleteConfirmModal,
} from '@/components';

export const ToolCatalogPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [namespace, setNamespace] = useState<string>('team1');
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [toolToDelete, setToolToDelete] = useState<Tool | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const {
    data: tools = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ['tools', namespace],
    queryFn: () => toolService.list(namespace),
    enabled: !!namespace,
  });

  const deleteMutation = useMutation({
    mutationFn: ({
      namespace: ns,
      name,
    }: {
      namespace: string;
      name: string;
    }) => toolService.delete(ns, name),
    onSuccess: (_data, variables) => {
      queryClient.setQueryData<Tool[]>(
        ['tools', variables.namespace],
        (old) => old?.filter((t) => t.name !== variables.name) ?? []
      );
      queryClient.invalidateQueries({ queryKey: ['tools', variables.namespace] });
      handleCloseDeleteModal();
    },
  });

  const handleDeleteClick = (tool: Tool) => {
    setToolToDelete(tool);
    setDeleteModalOpen(true);
    setOpenMenuId(null);
  };

  const handleCloseDeleteModal = () => {
    setDeleteModalOpen(false);
    setToolToDelete(null);
    setDeleteConfirmText('');
  };

  const handleDeleteConfirm = () => {
    if (toolToDelete && deleteConfirmText === toolToDelete.name) {
      deleteMutation.mutate({
        namespace: toolToDelete.namespace,
        name: toolToDelete.name,
      });
    }
  };

  const columns = ['Name', 'Description', 'Status', 'Labels', 'Workload', ''];

  const renderLabels = (tool: Tool) => {
    const labels = [];
    if (tool.labels.protocol) {
      tool.labels.protocol.forEach((p) => {
        labels.push(
          <Label key={`protocol-${p}`} color="blue" isCompact>
            {p.toUpperCase()}
          </Label>
        );
      });
    }
    if (tool.labels.framework) {
      labels.push(
        <Label key="framework" color="purple" isCompact>
          {tool.labels.framework}
        </Label>
      );
    }
    if (tool.workloadType) {
      labels.push(
        <Label key="workload" color="grey" isCompact>
          {tool.workloadType}
        </Label>
      );
    }
    return <LabelGroup>{labels}</LabelGroup>;
  };

  const getMenuId = (tool: Tool) => `${tool.namespace}-${tool.name}`;

  return (
    <>
      <CatalogPageLayout
        title="Tool Catalog"
        namespace={namespace}
        onNamespaceChange={setNamespace}
        primaryButtonLabel="Import Tool"
        primaryButtonIcon={<PlusCircleIcon />}
        onPrimaryAction={() => navigate('/tools/import')}
      >
        <CatalogSection
          title="Built tools"
          description="Tools that have a workload from a successful build (Deployment, StatefulSet, or Job)."
        >
          {isLoading ? (
            <div className="kagenti-loading-center">
              <Spinner size="lg" aria-label="Loading tools" />
            </div>
          ) : isError ? (
            <EmptyState>
              <EmptyStateHeader
                titleText="Error loading tools"
                icon={<EmptyStateIcon icon={ToolboxIcon} />}
                headingLevel="h4"
              />
              <EmptyStateBody>
                {error instanceof Error
                  ? error.message
                  : 'Unable to fetch tools from the cluster.'}
              </EmptyStateBody>
            </EmptyState>
          ) : tools.length === 0 ? (
            <EmptyState>
              <EmptyStateHeader
                titleText="No built tools"
                icon={<EmptyStateIcon icon={ToolboxIcon} />}
                headingLevel="h4"
              />
              <EmptyStateBody>
                No built tools in namespace &quot;{namespace}&quot;. Import a
                tool from source to build and deploy.
              </EmptyStateBody>
              <EmptyStateFooter>
                <EmptyStateActions>
                  <Button
                    variant="primary"
                    onClick={() => navigate('/tools/import')}
                  >
                    Import Tool
                  </Button>
                </EmptyStateActions>
              </EmptyStateFooter>
            </EmptyState>
          ) : (
            <Table aria-label="Built tools table" variant="compact">
              <Thead>
                <Tr>
                  {columns.map((col, idx) => (
                    <Th key={col || `col-${idx}`}>{col}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {tools.map((tool) => {
                  const menuId = getMenuId(tool);
                  return (
                    <Tr key={menuId}>
                      <Td dataLabel="Name">
                        <Button
                          variant="link"
                          isInline
                          onClick={() =>
                            navigate(
                              `/tools/${tool.namespace}/${tool.name}`
                            )
                          }
                        >
                          {tool.name}
                        </Button>
                      </Td>
                      <Td dataLabel="Description">
                        {tool.description || 'No description'}
                      </Td>
                      <Td dataLabel="Status">
                        <StatusBadge status={tool.status} />
                      </Td>
                      <Td dataLabel="Labels">{renderLabels(tool)}</Td>
                      <Td dataLabel="Workload">
                        <WorkloadTypeLabel workloadType={tool.workloadType} />
                      </Td>
                      <Td isActionCell>
                        <Dropdown
                          isOpen={openMenuId === menuId}
                          onSelect={() => setOpenMenuId(null)}
                          onOpenChange={(isOpen) =>
                            setOpenMenuId(isOpen ? menuId : null)
                          }
                          toggle={(toggleRef: React.Ref<MenuToggleElement>) => (
                            <MenuToggle
                              ref={toggleRef}
                              aria-label="Actions menu"
                              variant="plain"
                              onClick={() =>
                                setOpenMenuId(
                                  openMenuId === menuId ? null : menuId
                                )
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
                                navigate(
                                  `/tools/${tool.namespace}/${tool.name}`
                                )
                              }
                            >
                              View details
                            </DropdownItem>
                            <DropdownItem
                              key="delete"
                              onClick={() => handleDeleteClick(tool)}
                              isDanger
                            >
                              Delete tool
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
        title="Delete tool?"
        bodyMessage={
          <>
            <Icon status="warning" style={{ marginRight: '8px' }}>
              <ExclamationTriangleIcon />
            </Icon>
            The tool <strong>{toolToDelete?.name}</strong> will be permanently
            deleted. This action cannot be undone.
          </>
        }
        confirmName={toolToDelete?.name ?? ''}
        confirmValue={deleteConfirmText}
        onConfirmValueChange={setDeleteConfirmText}
        confirmInputAriaLabel="Confirm tool name"
      />
    </>
  );
};

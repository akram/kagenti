// Copyright 2025 IBM Corp.
// Licensed under the Apache License, Version 2.0

import React from 'react';
import {
  Modal,
  ModalVariant,
  Button,
  TextInput,
  Text,
  TextContent,
} from '@patternfly/react-core';

export interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
  title: string;
  bodyMessage: React.ReactNode;
  confirmName: string;
  confirmValue: string;
  onConfirmValueChange: (value: string) => void;
  confirmInputAriaLabel: string;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  isPending,
  title,
  bodyMessage,
  confirmName,
  confirmValue,
  onConfirmValueChange,
  confirmInputAriaLabel,
}) => (
  <Modal
    variant={ModalVariant.small}
    titleIconVariant="warning"
    title={title}
    isOpen={isOpen}
    onClose={onClose}
    actions={[
      <Button
        key="delete"
        variant="danger"
        onClick={onConfirm}
        isLoading={isPending}
        isDisabled={isPending || confirmValue !== confirmName}
      >
        Delete
      </Button>,
      <Button
        key="cancel"
        variant="link"
        onClick={onClose}
        isDisabled={isPending}
      >
        Cancel
      </Button>,
    ]}
  >
    <TextContent>
      <Text>{bodyMessage}</Text>
      <Text component="small" style={{ marginTop: '16px', display: 'block' }}>
        Type <strong>{confirmName}</strong> to confirm deletion:
      </Text>
    </TextContent>
    <TextInput
      id="delete-confirm-input"
      value={confirmValue}
      onChange={(_e, value) => onConfirmValueChange(value)}
      aria-label={confirmInputAriaLabel}
      style={{ marginTop: '8px' }}
    />
  </Modal>
);

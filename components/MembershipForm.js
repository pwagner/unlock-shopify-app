import React, { useState, forwardRef, useCallback } from "react";
import {
  Form,
  FormLayout,
  Stack,
  Button,
  Card,
  Select,
  Checkbox,
  Heading,
} from "@shopify/polaris";

import { LockMultiAdder } from "./LockMultiAdder";

const MembershipForm = forwardRef(
  (
    {
      id,
      value,
      discounts,
      index,
      onSave,
      onDelete,
      isLoading,
      otherMembershipLockAddresses,
    },
    ref
  ) => {
    return (
      <Card key={`card-${index}`} sectioned>
        <div style={{ float: "left" }}>
          <Heading>{value.lockName}</Heading>
        </div>
        <Stack distribution="trailing">
          <Button
            small
            onClick={() => onDelete(value.lockName, value.metafieldId)}
          >
            X
          </Button>
        </Stack>
        <br />
        <Form onSubmit={onSave}>
          <FormLayout>
            <input
              type="hidden"
              name="metafieldId"
              value={value && value.metafieldId}
            />
            <input
              type="hidden"
              name="lockName"
              value={value && value.lockName}
            />

            <LockBenefitSelect
              name="discountId"
              discounts={discounts}
              defaultValue={(value && value.discountId) || ""}
            />

            <LockMultiAdder
              name="lockAddresses"
              lockAddresses={(value && value.lockAddresses) || []}
              otherMembershipLockAddresses={otherMembershipLockAddresses || []}
            />

            <IsEnabledCheckbox
              name="enabled"
              checked={(value && value.isEnabled) || false}
            />

            <Stack distribution="trailing">
              <Button primary submit disabled={isLoading}>
                {isLoading ? "Saving..." : "Save"}
              </Button>
            </Stack>
          </FormLayout>
        </Form>
      </Card>
    );
  }
);

const LockBenefitSelect = ({ name, discounts, defaultValue }) => {
  if (!discounts) return;
  const [selected, setSelected] = useState(defaultValue);
  const handleSelectChange = useCallback((value) => setSelected(value), []);
  const options = [{ label: "-- Select Discount --", value: "" }];
  discounts.map((code) => {
    options.push({ label: code, value: code });
  });

  return (
    <Select
      label="Benefit:"
      labelInline
      options={options}
      onChange={handleSelectChange}
      value={selected}
      name={name}
      helpText="Select the discount associated with this membership."
    />
  );
};

const IsEnabledCheckbox = (props) => {
  const [checked, setChecked] = useState(props.checked);
  const handleChange = useCallback((newChecked) => setChecked(newChecked), []);
  const helpText = checked ? "Membership is enabled" : "Membership is disabled";

  return (
    <Checkbox
      label="Active"
      name="enabled"
      helpText={helpText}
      checked={checked}
      onChange={handleChange}
    />
  );
};

export default MembershipForm;

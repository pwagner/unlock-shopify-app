import React, { useState, useEffect, forwardRef, useCallback } from "react";
import {
  TextField,
  Form,
  FormLayout,
  Stack,
  Button,
  Card,
  Select,
  Checkbox,
} from "@shopify/polaris";

const handleTextInput = (e) => {
  this.setState({ [e.target.name]: [e.target.value] });
};

const MembershipForm = forwardRef(
  ({ id, value, discounts, index, onSave, onDelete, ...props }, ref) => {
    return (
      <Card key={`card-${index}`} sectioned>
        <div style={{ float: "left" }}>
          <h2 className="Polaris-Heading">Membership #{index}</h2>
        </div>
        <Stack distribution="trailing">
          <Button
            small
            onClick={() => onDelete(value.address, value.metafieldId)}
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
            <TextField
              name="lockAddress"
              value={value && value.address}
              disabled
            />
            <LockNetworkSelect
              name="networkId"
              defaultValue={(value && value.networkId) || 100}
            />
            <LockBenefitSelect
              name="discountId"
              discounts={discounts}
              defaultValue={(value && value.discountId) || ""}
            />
            <LockTextField
              label="Lock name"
              name="name"
              helpText="Explain the benefit your customers receive here"
              onChange={handleTextInput}
              defaultValue={(value && value.name) || ""}
            />
            <LockTextField
              label="Call to action"
              name="cta"
              helpText="Enter an engaging label for the join-button here"
              onChange={handleTextInput}
              defaultValue={(value && value.cta) || ""}
            />
            <IsEnabledCheckbox
              name="enabled"
              checked={(value && value.isEnabled) || false}
            />

            <p>
              <b>Note:</b> You can add the following attribute to any HTML tag
              in your theme's code to turn it into an unlock button for this
              lock. It uses the Unlock Paywall and contains the paywall
              configuration for this lock.
            </p>
            <input
              disabled
              value={`onclick='window.showUnlockPaywall(${JSON.stringify({
                network: parseInt(value && value.networkId),
                locks: {
                  [value && value.address]: {
                    name: value && value.name,
                  },
                },
                icon:
                  "https://unlock-protocol.com/static/images/svg/unlock-word-mark.svg",
                callToAction: {
                  default: value && value.cta,
                },
              })})'`}
            />

            <Stack distribution="trailing">
              <Button primary submit>
                Save
              </Button>
            </Stack>
          </FormLayout>
        </Form>
      </Card>
    );
  }
);

const LockNetworkSelect = ({ name, defaultValue }) => {
  const [selected, setSelected] = useState(defaultValue);
  const handleSelectChange = useCallback((value) => setSelected(value), []);
  const options = [
    { label: "xDai", value: "100" },
    { label: "Ethereum", value: "1" },
    { label: "Rinkeby", value: "4" },
  ];

  return (
    <Select
      label="Network:"
      labelInline
      options={options}
      onChange={handleSelectChange}
      value={selected}
      name={name}
    />
  );
};

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
    />
  );
};

const LockTextField = (props) => {
  const [value, setValue] = useState(props.defaultValue);
  const handleChange = useCallback((newValue) => setValue(newValue), []);

  return <TextField {...props} value={value} onChange={handleChange} />;
};

const IsEnabledCheckbox = (props) => {
  const [checked, setChecked] = useState(props.checked);
  const handleChange = useCallback((newChecked) => setChecked(newChecked), []);
  const helpText = checked ? "Lock is enabled" : "Lock is disabled";

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

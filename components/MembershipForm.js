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
  Icon,
  Collapsible,
  TextContainer,
} from "@shopify/polaris";
import {
  BuyButtonButtonLayoutMajor,
  DuplicateMinor,
} from "@shopify/polaris-icons";
import copy from "copy-to-clipboard";

const handleTextInput = (e) => {
  this.setState({ [e.target.name]: [e.target.value] });
};

const MembershipForm = forwardRef(
  (
    { id, value, discounts, index, onSave, onDelete, isLoading, ...props },
    ref
  ) => {
    const [open, setOpen] = useState(false);

    const handleToggle = useCallback(() => setOpen((open) => !open), []);

    const handleCopy = (e) => copy(e.target.elements.snippet.value);

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
              label="Membership name"
              name="name"
              helpText="Explain the benefit your members receive here"
              onChange={handleTextInput}
              defaultValue={(value && value.name) || ""}
            />
            <IsEnabledCheckbox
              name="enabled"
              checked={(value && value.isEnabled) || false}
            />

            <Stack distribution="trailing">
              <Button
                onClick={handleToggle}
                ariaExpanded={open}
                ariaControls="basic-collapsible"
                icon={<Icon source={BuyButtonButtonLayoutMajor} color="base" />}
              >
                HTML-Code for Devs
              </Button>
              <Button primary submit disabled={isLoading}>
                {isLoading ? "Saving..." : "Save"}
              </Button>
            </Stack>
          </FormLayout>
        </Form>

        <Collapsible
          open={open}
          id="basic-collapsible"
          transition={{ duration: "500ms", timingFunction: "ease-in-out" }}
          expandOnPrint
        >
          <TextContainer>
            <h3>"onclick"-attribute:</h3>
            <p>
              You can add the following attribute to any HTML tag in your
              theme's code to turn it into an unlock button for this lock. It
              uses the <b>Unlock Paywall</b> and contains the paywall
              <b>configuration</b> for this lock.
            </p>
            <Form onSubmit={handleCopy}>
              <FormLayout>
                <Stack distribution="leading">
                  <TextField
                    name="snippet"
                    value={`onclick='window.showUnlockPaywall(${JSON.stringify({
                      locks: {
                        [value && value.address]: {
                          network: parseInt(value && value.networkId),
                          name: value && value.name,
                        },
                      },
                      icon:
                        "https://unlock-protocol.com/static/images/svg/unlock-word-mark.svg",
                      callToAction: {
                        default: "Unlock",
                      },
                    })})'`}
                  />
                  <Button
                    submit
                    size="slim"
                    icon={<Icon source={DuplicateMinor} color="base" />}
                  >
                    Copy
                  </Button>
                </Stack>
              </FormLayout>
            </Form>
          </TextContainer>
        </Collapsible>
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

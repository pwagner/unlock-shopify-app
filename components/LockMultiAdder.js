import React, { useState, useCallback } from "react";
import {
  Banner,
  Button,
  Stack,
  Tag,
  TextField,
  InlineError,
} from "@shopify/polaris";

const LockMultiAdder = ({
  name,
  lockAddresses,
  otherMembershipLockAddresses,
}) => {
  const [selectedOptions, setSelectedOptions] = useState(lockAddresses);
  const [inputValue, setInputValue] = useState("");
  const [isValidAddress, setIsValidAddress] = useState(true);
  const [isDuplicateAddress, setIsDuplicateAddress] = useState(false);
  const [lockHintDismissed, setLockHintDismissed] = useState(false);

  const validateAddress = (string) => string.match(/^0x[a-fA-F0-9]{40}$/);

  const updateText = useCallback((value) => {
    setInputValue(value);
    if (value === "") {
      setIsValidAddress(true);
    } else {
      setIsValidAddress(validateAddress(value));
    }
    setIsDuplicateAddress(false);
  }, []);

  const removeTag = useCallback(
    (tag) => () => {
      const options = [...selectedOptions];
      options.splice(options.indexOf(tag), 1);
      setSelectedOptions(options);
    },
    [selectedOptions]
  );

  const handleAddAddress = useCallback(() => {
    if (otherMembershipLockAddresses.indexOf(inputValue) > -1) {
      setIsDuplicateAddress(true);

      return;
    }

    if (selectedOptions.indexOf(inputValue) === -1) {
      setSelectedOptions([...selectedOptions, inputValue]);
    }

    setInputValue("");
    setIsDuplicateAddress(false);
  });

  const handleDismissLockHint = useCallback(() => {
    console.log("handleDismissLockHint");
    setLockHintDismissed(true);
  });

  const hasSelectedOptions = selectedOptions.length > 0;

  const tagsMarkup = hasSelectedOptions
    ? selectedOptions.map((option) => {
        let tagLabel = "";
        tagLabel = option.replace("_", " ");
        return (
          <Tag key={`option${option}`} onRemove={removeTag(option)}>
            {tagLabel}
          </Tag>
        );
      })
    : null;

  const selectedTagMarkup = hasSelectedOptions ? (
    <Stack spacing="extraTight">{tagsMarkup}</Stack>
  ) : (
    <Banner
      title="Add the first lock associated with this membership below"
      status="warning"
    />
  );

  const unlockDashboardLinkMarkup =
    !lockHintDismissed && !hasSelectedOptions ? (
      <div>
        <br />
        <Banner
          title="No Lock?"
          status="info"
          onDismiss={handleDismissLockHint}
        >
          <p>
            You can create your own locks in the{" "}
            <a href="https://app.unlock-protocol.com/dashboard" target="_blank">
              Unlock Protocol Dashboard
            </a>
            .
          </p>
        </Banner>
      </div>
    ) : null;

  return (
    <div>
      <input
        type="hidden"
        name={name}
        value={JSON.stringify(selectedOptions)}
      />

      <Stack vertical>
        <b>Unlock Protocol Locks:</b>
        {selectedTagMarkup}
        <TextField
          onChange={updateText}
          value={inputValue}
          placeholder="E.g. 0x0b74E0ff5B61a16e94a5A29938d4Ea149CcD1619"
          connectedRight={
            <Button
              disabled={!isValidAddress || inputValue.length === 0}
              onClick={handleAddAddress}
            >
              Add
            </Button>
          }
          helpText="Enter the smart contract address (Ethereum, BSC, Polygon, XDai, Optimism)."
          label="Address"
          prefix="Address:"
          labelHidden
        />
      </Stack>
      {isDuplicateAddress && (
        <InlineError
          message="This lock address is already associated with an existing membership"
          id="lockAddressDuplicateError"
        />
      )}
      {!isValidAddress && (
        <InlineError
          message="Invalid pattern for lock address"
          id="lockAddressValidationError"
        />
      )}
      {unlockDashboardLinkMarkup}
    </div>
  );
};

export { LockMultiAdder };

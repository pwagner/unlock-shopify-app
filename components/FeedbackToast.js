import React, { useCallback, useState } from "react";
import { Frame, Toast } from "@shopify/polaris";

export default function FeedbackToast({ message }) {
  const [isToastActive, setIsToastActive] = useState(true);

  const toggleToast = useCallback(
    () => setIsToastActive((isToastActive) => !isToastActive),
    []
  );

  const toastMarkup = isToastActive ? (
    <Toast content={message} onDismiss={toggleToast} />
  ) : null;

  return (
    <div style={{ marginTop: "1px", height: "0px" }}>
      <Frame>{toastMarkup}</Frame>
    </div>
  );
}

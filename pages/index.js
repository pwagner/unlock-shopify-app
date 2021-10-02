import React from "react";
import {
  Page,
  Layout,
  TextField,
  Form,
  FormLayout,
  Stack,
  Button,
  InlineError,
  Card,
  Link,
  Banner,
  DisplayText,
} from "@shopify/polaris";
import { TitleBar, Context } from "@shopify/app-bridge-react";
import { authenticatedFetch } from "@shopify/app-bridge-utils";
import { Redirect } from "@shopify/app-bridge/actions";
import MembershipForm from "../components/MembershipForm";

class Index extends React.Component {
  static contextType = Context;
  static fetchWithAuth; // for authenticated requests to Shopify Admin API via app backend
  static redirect;

  constructor(props) {
    super(props);
    this.state = {
      memberships: [],
      discounts: [],
      newMembershipName: "",
      newMembershipNameError: false,
      isContinueing: false,
      isLoading: false,
      isAddingMembership: false,
      hasLoadedLocks: false,
    };
  }

  componentDidMount() {
    const app = this.context;
    this.redirect = Redirect.create(app);
    this.fetchWithAuth = authenticatedFetch(app);
    this.loadMemberships();
  }

  render() {
    return (
      <Page>
        <TitleBar title="Settings" />
        <Layout>
          <Layout.AnnotatedSection
            title="Step 1: Setup Memperships"
            description="Add memberships to your shop, and reward members with discounts."
          >
            <div style={{ marginBottom: "12px" }}>
              <DisplayText size="extraLarge">Memberships:</DisplayText>
            </div>

            {!this.state.isAddingMembership &&
            this.state.hasLoadedLocks &&
            this.state.memberships.length === 0 ? (
              <div style={{ marginBottom: "12px" }}>
                <Banner>Click the button to add your first membership.</Banner>
              </div>
            ) : (
              this.state.memberships.map((value, index) => (
                <MembershipForm
                  value={value}
                  discounts={this.state.discounts}
                  index={index + 1}
                  key={value.metafieldId}
                  onSave={this.handleSaveMembership}
                  onDelete={this.handleDeleteMembership}
                  isLoading={this.state.isLoading}
                  otherMembershipLockAddresses={this.state.memberships.reduce(
                    (acc, { lockAddresses }) => {
                      if (!lockAddresses || lockAddresses.length < 1)
                        return acc;

                      lockAddresses.map((addr) => acc.push(addr));

                      return acc;
                    },
                    []
                  )}
                />
              ))
            )}

            {this.state.hasLoadedLocks ? (
              this.state.isAddingMembership ? (
                <Card sectioned>
                  <div style={{ float: "left" }}>
                    <h2 className="Polaris-Heading">New Membership</h2>
                  </div>
                  <Stack distribution="trailing">
                    <Button small onClick={this.cancelAddMembership}>
                      X
                    </Button>
                  </Stack>
                  <br />
                  <Form onSubmit={this.handleContinue}>
                    <FormLayout>
                      {this.state.newMembershipNameError && (
                        <InlineError
                          message={this.state.newMembershipNameError}
                          id="membershipNameError"
                        />
                      )}
                      <TextField
                        id="membershipName"
                        label="Membership Name"
                        value={this.state.newMembershipName}
                        onChange={this.validateMembershipName}
                        aria-describedby="membershipNameError"
                        helpText="In the next step you'll configure the benefit and criteria for membership."
                        placeholder="Enter a unique name for the membership"
                      />
                      <Stack distribution="trailing">
                        <Button
                          primary
                          submit
                          disabled={
                            this.state.newMembershipNameError ||
                            this.state.newMembershipName.length < 1 ||
                            this.state.isContinueing
                          }
                        >
                          {this.state.isContinueing ? "Saving..." : "Continue"}
                        </Button>
                      </Stack>
                    </FormLayout>
                  </Form>
                </Card>
              ) : (
                <div style={{ marginTop: "12px" }}>
                  <Button
                    primary
                    onClick={this.addMembership}
                    disabled={!this.state.hasLoadedLocks}
                  >
                    New Membership
                  </Button>
                </div>
              )
            ) : (
              <Banner>Loading, please wait…</Banner>
            )}
          </Layout.AnnotatedSection>

          {this.state.memberships.length > 0 && (
            <Layout.AnnotatedSection
              title="Step 2: Publish Member Benefits"
              description="Show your customers what benefits await them, if they get a membership."
            >
              <Card title="Add Theme Section" sectioned>
                <p>
                  Add sections to your theme in your Online Store settings under{" "}
                  <Link onClick={this.handleThemeClick}>Themes: Customize</Link>{" "}
                  <br />
                  You'll find the "MB|"-sections in the <b>Promotional</b>{" "}
                  category. There are currently hero and top-bar sections.
                </p>
              </Card>
            </Layout.AnnotatedSection>
          )}
        </Layout>

        <Button onClick={this.handleReset}>Reset App</Button>
      </Page>
    );
  }

  handleThemeClick = () => {
    this.redirect.dispatch(Redirect.Action.ADMIN_PATH, "/themes");
  };

  handleReset = async () => {
    try {
      console.log("Reset initiated");
      const resetRes = await this.fetchWithAuth(`/api/reset`, {
        method: "GET",
      });
      const response = await resetRes.json();
      console.log("Deleted app resources", response);
      await this.loadMemberships();
    } catch (err) {
      console.log("Error in reset", err);
    }
  };

  loadMemberships = async () => {
    try {
      const lockRes = await this.fetchWithAuth(`/api/memberships`, {
        method: "GET",
      });
      const response = await lockRes.json();
      console.log("locks response", response);

      if (response.errors || !response.data) {
        throw `Error in metafield response: ${JSON.stringify(response)}`;
      }

      this.setState({
        memberships: response.data.memberships,
        discounts: response.data.discounts,
        hasLoadedLocks: true,
      });
    } catch (err) {
      console.log("Error in loadMemberships", err);
    }
  };

  handleContinue = async () => {
    this.setState({ isContinueing: true });
    try {
      const saveRes = await this.fetchWithAuth("/api/addMembership", {
        method: "POST",
        body: JSON.stringify({
          lockName: this.state.newMembershipName,
        }),
      });
      const result = await saveRes.json();

      if (result.status !== "success" || !result.data) {
        throw result.errors;
      }

      const { metafieldId } = result.data;
      this.setState({
        memberships: [
          ...this.state.memberships,
          {
            metafieldId,
            lockName: this.state.newMembershipName,
          },
        ],
      });
      this.setState({
        newMembershipName: "",
        isAddingMembership: false,
        isContinueing: false,
      });
    } catch (err) {
      this.setState({ isContinueing: false });
      console.log("Error in handleContinue:", err);
    }
  };

  handleSaveMembership = async (e) => {
    this.setState({ isLoading: true });
    try {
      const otherMemberships = this.state.memberships
        .filter(
          ({ metafieldId }) =>
            metafieldId != e.target.elements.metafieldId.value
        )
        .map(({ lockName, lockAddresses, discountId }) => ({
          lockName,
          lockAddresses,
          discountId,
        }));
      const metafieldId = e.target.elements.metafieldId.value;

      const lockName = e.target.elements.lockName.value;
      // const address = e.target.elements.lockAddress.value;
      const lockAddresses = JSON.parse(e.target.elements.lockAddresses.value);
      console.log("handleSaveMembership lockAddresses", lockAddresses);

      const isEnabled = e.target.elements.enabled.checked;
      const discountId = e.target.elements.discountId.value;

      const membershipDetails = {
        lockAddresses,
        lockName,
        isEnabled,
        discountId,
        metafieldId,
        otherMemberships,
      };

      console.log("membershipDetails", membershipDetails);

      const saveRes = await this.fetchWithAuth("/api/saveMembership", {
        method: "POST",
        body: JSON.stringify(membershipDetails),
      });
      const result = await saveRes.json();
      if (result.status !== "success" || !result.data) {
        throw result.errors;
      }
      console.log("Saved lock");
      const { scriptTagId } = result.data;
      if (scriptTagId) {
        console.log("Active scriptTag ID:", scriptTagId);
      }
      await this.loadMemberships();
    } catch (err) {
      console.log("Error in handleSaveMembership:", err);
    }
    this.setState({ isLoading: false });
  };

  handleDeleteMembership = async (name, metafieldId) => {
    try {
      const saveRes = await this.fetchWithAuth("/api/removeMembership", {
        method: "POST",
        body: JSON.stringify({
          metafieldId,
        }),
      });
      const result = await saveRes.json();
      if (!result || result.status !== "success") {
        throw result.errors;
      }
      this.setState({
        memberships: this.state.memberships.filter(
          ({ lockName }) => lockName !== name
        ),
      });
    } catch (err) {
      console.log("Error in handleDeleteMembership:", err);
    }
  };

  validateMembershipName = (name) => {
    this.setState({ newMembershipName: name });
    if (name.length > 0) return;

    this.setState({ newMembershipNameError: false });
  };

  addMembership = () => {
    this.setState({ isAddingMembership: true });
  };

  cancelAddMembership = () => {
    this.setState({ isAddingMembership: false });
  };
}

export default Index;

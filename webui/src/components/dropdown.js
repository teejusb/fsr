import React from "react";

import NavDropdown from "react-bootstrap/NavDropdown";
import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";

const Dropdown = (props) => {
  const { profiles, emit, activeProfile, webUIDataRef } = props;

  const AddProfile = (e) => {
    // Only add a profile on the enter key.
    if (e.keyCode === 13) {
      emit(["add_profile", e.target.value, webUIDataRef.current.curThresholds]);
      // Reset the text box.
      e.target.value = "";
    }
    return false;
  };

  const RemoveProfile = (e) => {
    // The X button is inside the Change Profile button, so stop the event from bubbling up and triggering the ChangeProfile handler.
    e.stopPropagation();
    // Strip out the "X " added by the button.
    const profile_name = e.target.parentNode.innerText.replace("X ", "");
    emit(["remove_profile", profile_name]);
  };

  const ChangeProfile = (e) => {
    // Strip out the "X " added by the button.
    const profile_name = e.target.innerText.replace("X ", "");
    emit(["change_profile", profile_name]);
  };

  return (
    <NavDropdown alignRight title="Profile" id="collasible-nav-dropdown">
      {profiles.map(function (profile) {
        if (profile === activeProfile) {
          return (
            <NavDropdown.Item
              key={profile}
              style={{ paddingLeft: "0.5rem" }}
              onClick={ChangeProfile}
              active
            >
              <Button variant="light" onClick={RemoveProfile}>
                X
              </Button>{" "}
              {profile}
            </NavDropdown.Item>
          );
        } else {
          return (
            <NavDropdown.Item
              key={profile}
              style={{ paddingLeft: "0.5rem" }}
              onClick={ChangeProfile}
            >
              <Button variant="light" onClick={RemoveProfile}>
                X
              </Button>{" "}
              {profile}
            </NavDropdown.Item>
          );
        }
      })}
      <NavDropdown.Divider />
      <Form inline onSubmit={(e) => e.preventDefault()}>
        <Form.Control
          onKeyDown={AddProfile}
          style={{ marginLeft: "0.5rem", marginRight: "0.5rem" }}
          type="text"
          placeholder="New Profile"
        />
      </Form>
    </NavDropdown>
  );
};

export default Dropdown;

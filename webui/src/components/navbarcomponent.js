import React, { useState } from "react";

import Button from "react-bootstrap/Button";
import Navbar from "react-bootstrap/Navbar";
import Nav from "react-bootstrap/Nav";
import Dropdown from "./dropdown";

import { Link } from "react-router-dom";

const NavbarComponent = (props) => {
  const { emit, profiles, activeProfile, webUIDataRef } = props;
  const [state, setState] = useState({
    openModal: false,
    profileToDelete: null
  })

  const toggleModal = (profileName) => {
    setState(prevState => ({
      modalOpen: !prevState.modalOpen,
      profileToDelete: profileName
    }))
  }

  const renderModal = () => {
    return (
      <div className="delete-modal">
        <div className="modal-block" onClick={() => toggleModal(null)}></div>
        <div className="modal-body">
          <h4>Do you want to delete {state.profileToDelete}?</h4>
          <span>
            <Button variant="light" onClick={(e) => removeProfile(state.profileToDelete, e)}>
              YES
            </Button>
            <Button variant="light" onClick={() => toggleModal(null)}>
              NO
            </Button>
          </span>
        </div>
      </div>
    )
  }

  const removeProfile = (profileName, e) => {
    e.stopPropagation();
    emit(["remove_profile", profileName]);
    setState({
      modalOpen: false,
      profileToDelete: null
    })
  }

  return (
    <>
      <Navbar bg="light">
        <Navbar.Brand as={Link} to="/">
          FSR UI
        </Navbar.Brand>
        <Nav>
          <Nav.Item>
            <Nav.Link as={Link} to="/plot">
              Data Plot
            </Nav.Link>
          </Nav.Item>
        </Nav>
        <Nav className="ml-auto">
          <Dropdown
            toggleModal={toggleModal}
            emit={emit}
            profiles={profiles}
            activeProfile={activeProfile}
            webUIDataRef={webUIDataRef}
          />
        </Nav>
      </Navbar>
      {state.modalOpen && renderModal()}
    </>
  );
};

export default NavbarComponent;

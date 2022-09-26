import React from "react";

import Navbar from "react-bootstrap/Navbar";
import Nav from "react-bootstrap/Nav";
import Dropdown from "./dropdown";

import { Link } from "react-router-dom";

const NavbarComponent = (props) => {
  const { emit, profiles, activeProfile, webUIDataRef } = props;

  return (
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
        <Nav.Item>
          <Nav.Link as={Link} to="/fast">
            New UI
          </Nav.Link>
        </Nav.Item>
      </Nav>
      <Nav className="ml-auto">
        <Dropdown
          emit={emit}
          profiles={profiles}
          activeProfile={activeProfile}
          webUIDataRef={webUIDataRef}
        />
      </Nav>
    </Navbar>
  );
};

export default NavbarComponent;

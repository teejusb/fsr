import React from "react";

const DeleteModal = (props) => {
  const { toggleModal, removeProfile, profile } = props;
  return (
    <div className="delete-modal">
      <div className="modal-block" onClick={() => toggleModal(null)} />
      <div className="modal-body">
        <h4>Do you want to delete {profile}?</h4>
        <span>
          <button onClick={(e) => removeProfile(profile, e)}>
            YES
          </button>
          <button onClick={() => toggleModal(null)}>
            NO
          </button>
        </span>
      </div>
    </div>
  )
}

export default DeleteModal
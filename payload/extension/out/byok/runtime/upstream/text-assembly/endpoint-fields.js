"use strict";

const { tryFromEndpointFieldsBasic } = require("./endpoint-fields-basic");
const { tryFromEndpointFieldsNextEditLoc } = require("./endpoint-fields-next-edit-loc");

function tryFromEndpointFields(endpoint, rawBody) {
  return tryFromEndpointFieldsBasic(endpoint, rawBody) || tryFromEndpointFieldsNextEditLoc(endpoint, rawBody);
}

module.exports = {
  tryFromEndpointFields
};


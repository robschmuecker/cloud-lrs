/**
 * Copyright ©2018. The Regents of the University of California (Regents). All Rights Reserved.
 *
 * Permission to use, copy, modify, and distribute this software and its documentation
 * for educational, research, and not-for-profit purposes, without fee and without a
 * signed licensing agreement, is hereby granted, provided that the above copyright
 * notice, this paragraph and the following two paragraphs appear in all copies,
 * modifications, and distributions.
 *
 * Contact The Office of Technology Licensing, UC Berkeley, 2150 Shattuck Avenue,
 * Suite 510, Berkeley, CA 94720-1620, (510) 643-7201, otl@berkeley.edu,
 * http://ipira.berkeley.edu/industry-info for commercial licensing opportunities.
 *
 * IN NO EVENT SHALL REGENTS BE LIABLE TO ANY PARTY FOR DIRECT, INDIRECT, SPECIAL,
 * INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING LOST PROFITS, ARISING OUT OF
 * THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION, EVEN IF REGENTS HAS BEEN ADVISED
 * OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * REGENTS SPECIFICALLY DISCLAIMS ANY WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE. THE
 * SOFTWARE AND ACCOMPANYING DOCUMENTATION, IF ANY, PROVIDED HEREUNDER IS PROVIDED
 * "AS IS". REGENTS HAS NO OBLIGATION TO PROVIDE MAINTENANCE, SUPPORT, UPDATES,
 * ENHANCEMENTS, OR MODIFICATIONS.
 */

var Joi = require('joi');

var DB = require('../lrs-core/db');
var log = require('../lrs-core/logger')('lrs-tenant');

/**
 * Get a Tenant instance by its API domain and LTI key
 *
 * @param  {String}     apiDomain             The domain on which Tenant is running
 * @param  {String}     ltiKey                The basic LTI key that will be used to embed the tools into Canvas
 * @param  {Function}   callback              Standard callback function
 * @param  {Object}     callback.err          An error object, if any
 * @param  {Tenant}     callback.tenant       The retrieved Tenant instance
 */
var getTenant = module.exports.getTenant = function(apiDomain, ltiKey, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    apiDomain: Joi.string().required(),
    ltiKey: Joi.string().alphanum().length(32)
  });

  var validationResult = Joi.validate({
    apiDomain: apiDomain,
    ltiKey: ltiKey
  }, validationSchema);

  if (validationResult.error) {
    return callback({code: 400, msg: validationResult.error.details[0].message});
  }

  // Retrieve the Canvas instance from the DB
  var options = {
    where: {
      tenant_api_domain: apiDomain,
      lti_key: ltiKey
    }
  };
  DB.Tenant.findOne(options).complete(function(err, tenant) {
    if (err) {
      log.error({err: err, apiDomain: apiDomain}, 'Failed to get a Tenant(Canvas) instance');
      return callback({code: 500, msg: err.message});
    } else if (!tenant) {
      log.warn({err: err, apiDomain: apiDomain}, 'A Tenant(Canvas) instance with the specified api domain and consumer lti key could not be found');
      return callback({code: 404, msg: 'A Tenant(Canvas) instance with the specified api domain and consumer lti key could not be found'});
    }

    return callback(null, tenant);
  });
};

/**
 * Get all Tenant instances
 *
 * @param  {Function}       callback                    Standard callback function
 * @param  {Object}         callback.err                An error that occurred, if any
 * @param  {Tenant[]}       callback.tenants           All Tenant instances
 */
var getTenants = module.exports.getTenants = function(callback) {
  DB.Tenant.findAll().complete(function(err, tenants) {
    if (err) {
      log.error({err: err}, 'Failed to retrieve all Tenant instances');
      return callback({code: 500, msg: err.message});
    }

    return callback(null, tenants);
  });
};

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

var _ = require('lodash');
var Joi = require('joi');
var moment = require('moment');

var DB = require('../lrs-core/db');
var log = require('../lrs-core/logger')('lrs-users');
var LRSUtil = require('../lrs-core/util');
var Sequelize = require('sequelize');

const Op = Sequelize.Op;

/**
* Get a user by its external id (UCB User login ID)
*
* @param  {Number}           externalId            The id of the user to retrieve
* @param  {Number}           tenantId              The id of the tenant the user belongs to
* @param  {Function}         callback              Standard callback function
* @param  {Object}           callback.err          An error that occurred, if any
* @param  {User}             callback.user         The requested user
*/
var getUserByExternalId = module.exports.getUserByExternalId = function(externalId, tenantId, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    externalId: Joi.string().required(),
    tenantId: Joi.number().required()
  });

  var validationResult = Joi.validate({
    externalId: externalId,
    tenantId: tenantId
  }, validationSchema);

  if (validationResult.error) {
    return callback({code: 400, msg: validationResult.error.details[0].message});
  }

  // Get the user from the DB
  var options = {
    where: {
      external_id: externalId,
      tenant_id: tenantId
    },
    include: [
      {
        model: DB.Tenant
      }
    ]
  };

  DB.User.findOne(options).complete(function(err, user) {
    if (err) {
      log.error({err: err, external_id: externalId}, 'An error occurred when getting a user');
      return callback({code: 500, msg: err.message});
    } else if (!user) {
      log.warn({external_id: externalId}, 'Could not find a user');
    }

    return callback(null, user);
  });
};


/**
* Get the most recent learning activity statements for the current user
*
* @param  {Object}           ctx                       Context containing the user for which to get the most recent learning activities
* @param  {Number}           [limit]                   The maximum number of results to retrieve. Defaults to 10
* @param  {Number}           [offset]                  The number to start paging from. Defaults to 0
* @param  {Function}         callback                  Standard callback function
* @param  {Object}           callback.err              An error that occurred, if any
* @param  {Object[]}         callback.activities       The most recent learning activities for the current user
*/
var getUserStatements = module.exports.getUserStatements = function(ctx, limit, offset, callback) {
  if (!ctx || !ctx.user) {
    log.warn('Prevented getting the most recent learning activities for the current user');
    return callback({code: 500, msg: 'Prevented getting the most recent learning activities for the current user'});
  }

  // Default some parameters
  limit = LRSUtil.getNumberParam(limit, 10, 1, 25);
  offset = LRSUtil.getNumberParam(offset, 0, 0);

  // Get the most recent activities from the DB
  var options = {
    where: {
      tenant_id: ctx.user.tenant_id,
      user_id: ctx.user.id
    },
    limit: limit,
    offset: offset,
    order: [ Sequelize.literal('timestamp DESC') ],
    include: [
      {
        model: DB.Credential,
        attributes: [ 'name' ]
      }
    ]
  };

  DB.Statement.findAndCountAll(options).complete(function(err, result) {
    if (err) {
      log.error({err: err, user: ctx.user.id}, 'Failed to get the most recent learning activities for the current user');
      return callback({code: 500, msg: err.message});
    }

    var data = {
      offset: offset,
      total: result.count,
      results: _.map(result.rows, function(activity) {
        return activity.toJSON();
      })
    };

    return callback(null, data);
  });
};

/**
* Get the total number of learning activities per month for the current user
*
* @param  {Object}           ctx                       Context containing the user for which to get the total number of learning activities per month
* @param  {Function}         callback                  Standard callback function
* @param  {Object}           callback.err              An error that occurred, if any
* @param  {Object[]}         callback.totalActivities  The total learning activities per month for the current user
*/
var getTotalActivities = module.exports.getTotalActivities = function(ctx, callback) {
  if (!ctx || !ctx.user) {
    log.warn('Prevented getting the total activities per month for the current user');
    return callback({code: 500, msg: 'Prevented getting the total activities per month for the current user'});
  }

  var sqlQuery = 'SELECT EXTRACT(year FROM timestamp) AS year, EXTRACT(month FROM timestamp) AS month, count(*)::int AS total';
  sqlQuery += ' FROM statements';
  sqlQuery += ' WHERE USER_ID = ? AND TENANT_ID = ?';
  sqlQuery += ' GROUP BY year, month';
  sqlQuery += ' ORDER BY year, month ASC';

  var options = {
    model: DB.Statement,
    replacements: [ctx.user.id, ctx.user.tenant_id],
    type: 'SELECT'
  };

  DB.getSequelize().query(sqlQuery, options).complete(function(err, results) {
    if (err) {
      log.error({err: err, user: ctx.user}, 'An error occurred when getting the total activities per month for a user');
      return callback({code: 500, msg: err.message});
    } else if (results.length === 0) {
      return callback(null, []);
    }

    results = _.map(results, function(result) {
      return result.toJSON();
    });

    var totalActivities = [];

    var currentYear = results[0].year;
    var currentMonth = results[0].month;
    var lastActivityMonth = parseInt(results[results.length - 1].month) + 1;
    var lastActivityYear = results[results.length - 1].year;

    while (currentYear !== lastActivityYear || currentMonth !== lastActivityMonth) {
      // Check if any activities were logged for the current month
      var month = _.find(results, {year: currentYear, month: currentMonth});
      // Parse the year and month combo to a formatable date
      var parsedMonth = moment(currentYear + '-' + currentMonth + '-1', 'YYYY-M-D');
      var result = {
        period: parsedMonth.format('MMMM YYYY'),
        total: month ? month.total : 0,
        current: moment().format('MMMM YYYY') === parsedMonth.format('MMMM YYYY')
      };
      totalActivities.push(result);

      // Process the next month
      if (currentMonth === 12) {
        currentMonth = 1;
        currentYear++;
      } else {
        currentMonth++;
      }

    }

    return callback(null, totalActivities);
  });
};

/**
* Get the most frequent learning activities for the current user
*
* @param  {Object}           ctx                       Context containing the user for which to get the top activities
* @param  {Function}         callback                  Standard callback function
* @param  {Object}           callback.err              An error that occurred, if any
* @param  {Object[]}         callback.topActivities    The top learning activities for the current user
*/
var getTopActivities = module.exports.getTopActivities = function(ctx, callback) {
  if (!ctx || !ctx.user) {
    log.warn('Prevented getting the top activities for the current user');
    return callback({code: 500, msg: 'Prevented getting the top activities for the current user'});
  }

  // Get the top activities from the DB
  var options = {
    where: {
      tenant_id: ctx.user.tenant_id,
      user_id: ctx.user.id
    },
    attributes: [['activity_type', 'activity'], [DB.getSequelize().fn('count', DB.getSequelize().col('uuid')), 'total']],
    group: [ 'activity_type' ],
    order: [ Sequelize.literal('total DESC') ]
  };

  DB.Statement.findAll(options).complete(function(err, topActivities) {
    if (err) {
      log.error({err: err, user: ctx.user}, 'An error occurred when getting the top activities for a user');
      return callback({code: 500, msg: err.message});
    }

    topActivities = _.map(topActivities, function(topActivity) {
      return topActivity.toJSON();
    });

    return callback(null, topActivities);
  });
};

/**
* Get the data sources that have generated learning activities for the current user
*
* @param  {Object}           ctx                       Context containing the user for which to get the data sources
* @param  {Function}         callback                  Standard callback function
* @param  {Object}           callback.err              An error that occurred, if any
* @param  {Object[]}         callback.topActivities    The data sources that have generated learning activities for the current user
*/
var getDataSources = module.exports.getDataSources = function(ctx, callback) {
  if (!ctx || !ctx.user) {
    log.warn('Prevented getting the data sources for the current user');
    return callback({code: 500, msg: 'Prevented getting the data sources for the current user'});
  }

  // Get the data souces from the DB
  var sqlQuery = 'SELECT s.total, w.name FROM (';
  sqlQuery += ' SELECT credential_id, COUNT(*)::int AS total';
  sqlQuery += ' FROM statements';
  sqlQuery += ' WHERE USER_ID = ? AND TENANT_ID = ?';
  sqlQuery += ' GROUP BY credential_id';
  sqlQuery += ' ORDER BY credential_id DESC';
  sqlQuery += ') s';
  sqlQuery += ' INNER JOIN credentials w ON w.id = s.credential_id';

  var options = {
    model: DB.Statement,
    replacements: [ctx.user.id, ctx.user.tenant_id],
    type: 'SELECT'
  };

  DB.getSequelize().query(sqlQuery, options).complete(function(err, results) {
    if (err) {
      log.error({err: err, user: ctx.user}, 'An error occurred when getting the data sources for a user');
      return callback({code: 500, msg: err.message});
    }

    results = _.map(results, function(result) {
      return result.toJSON();
    });

    return callback(null, results);
  });
};

/**
* Get the different projects that potentially have access to the current user's data
*
* @param  {Object}           ctx                       Context containing the user for which to the project that have access to its data
* @param  {Function}         callback                  Standard callback function
* @param  {Object}           callback.err              An error that occurred, if any
* @param  {Object[]}         callback.dataUses         The different projects that have access to the user's data and whether the user has opted out of this
*/
var getDataUses = module.exports.getDataUses = function(ctx, callback) {
  if (!ctx || !ctx.auth.tenant_id) {
    log.warn('Prevented getting the projects that have access to the current user data');
    return callback({code: 500, msg: 'Prevented getting the projects that have access to the current user data'});
  }
  var tenantId = ctx.auth.tenant_id;

  // Get the possible shared-data consumers from the DB
  var options = {
    where: {
      [Op.or]: [
        {
          tenant_id: tenantId,
          datashare: true
        },
        {
          tenant_id: null
        }
      ]
    }
  };
  if (ctx.user) {
    options['include'] = [
      {
        model: DB.User,
        attributes: [ 'id' ],
        required: false,
        where: {
          id: ctx.user.id,
          tenant_id: tenantId
        }
      }
    ];
  }

  DB.Credential.findAll(options).complete(function(err, dataUses) {
    if (err) {
      log.error({err: err, user: ctx.user}, 'An error occurred when getting the data usage details for user');
      return callback({code: 500, msg: err.message});
    }

    // Add the required content to the final response
    dataUses = _.map(dataUses, function(dataUse) {
      var optedOut = !dataUse.users || dataUse.users.length <= 0;

      return {
        id: dataUse.id,
        name: dataUse.name,
        description: dataUse.description,
        anonymous: dataUse.anonymous,
        share: optedOut
      };
    });

    return callback(null, dataUses);
  });
};

/**
* Validate and save user data share opt-in/opt-out request
*
* @param  {Object}           ctx                       Context containing the user for which to the project that have access to its data
* @param  {Object}           dataUse                   dataUse details from which project id's and
* @param  {Function}         callback                  Standard callback function
* @param  {Object}           callback.err              An error that occurred, if any
* @param  {Object[]}         callback.dataUses         The different projects that have access to the user's data and whether the user has opted out of this
*/

var saveUserOptOut = module.exports.saveUserOptOut = function(ctx, dataUse, callback) {

  log.info('Sample datause input :', dataUse);
  if (dataUse.share === false) {
    // check if the opt-out details for the user and credential with datashare permissions already exists
    getOrCreateOptOutDetails(ctx, dataUse, function(err, results) {
      if (err && err.code !== 404) {
        log.info({id: id}, 'Could not find a referenced opt out details for the user');
        return callback(err);
      }
      if (results) {
        log.info('The user %d has opt-out of data share for the project %d. Opt-out successful !', ctx.user.id, dataUse.id);
        return callback();
      }
    });

  } else if (dataUse.share === true) {
    // check if share option is set to true. Remove the use from the opt-out table.
    // This automatically enables data share option for the user on the selected project in the dataUse object
    // this will be the ids that you want to delete
    DB.Opt_out.destroy({
      where: {
        user_id: ctx.user.id,
        credential_id: dataUse.id
      }
    }).then(function(rowDeleted) {
      // rowDeleted will return number of rows deleted
      if (rowDeleted === 1) {
        log.info('The user %d has chosen to Opt-in for data share for project %d. Opt-in successful !', ctx.user.id, dataUse.id);
      }
    }, function(err) {
      log.error(err);
    });
    return callback();

  } else {

    // TODO : Handle deviations for wrong dataUse object in request body
    // Log information if the dataUse object in request body is not correct.
    log.info('The datause object has a wrong share value. Share has to be of type Boolean.');
    return callback();

  }
};

/**
 * Check student data share opt-out for specific project from the opt_outs table.
 *
 * @param  {Object}           ctx                       Context containing the user for which to the project that have access to its data
 * @param  {Object}           dataUse                   dataUse details from which project id's and
 * @param  {Function}         callback                  Standard callback function
 * @param  {Object}           callback.err              An error that occurred, if any
 * @param  {Object[]}         callback.dataUses         The different projects that have access to the user's data and whether the user has opted out of this
 */

var isStudentOptedOut = module.exports.isStudentOptedOut = function(userId, consumerCredentialId, callback) {
  // Get opt out details for user on a data use from the DB
  var options = {
    where: {
      user_id: userId,
      credential_id: consumerCredentialId
    }
  };
  DB.Opt_out.findOne(options).complete(function(err, data) {
    if (err) {
      log.error({err: err, external_id: externalId}, 'An error occurred when getting a user opt-out');
      return callback({code: 500, msg: err.message});
    }
    return callback(null, data);
  });
};


/**
* Retrieve/Create student data share opt-out selection for specific projects from the opt_outs table.
*
* @param  {Object}           ctx                       Context containing the user for which to the project that have access to its data
* @param  {Object}           dataUse                   dataUse details from which project id's and
* @param  {Function}         callback                  Standard callback function
* @param  {Object}           callback.err              An error that occurred, if any
* @param  {Object[]}         callback.dataUses         The different projects that have access to the user's data and whether the user has opted out of this
*/

var getOrCreateOptOutDetails = function(ctx, dataUse, callback) {

  // Get opt out details for user on a data use from the DB or create it if it doesn't exist yet
  var options = {
    where: {
      user_id: ctx.user.id,
      credential_id: dataUse.id
    }
  };


  log.info('Get OptOut details datause input :', dataUse.id);

  log.info('Get OptOut details datause input :', options);

  DB.Opt_out.findOrCreate(options).complete(function(err, data) {
    if (err) {
      log.error({err: err}, 'Failed to get or create a user opt-out for data share');
      return callback({code: 500, msg: err.message});
    }

    var userOptOutDetails = data[0];
    log.info('Creating/Retrieving Opt-out record in the table');

    return callback(null, userOptOutDetails);
  });

};

/**
 * Get a user. If the user doesn't exist, it will be created
 *
 * @param  {String}     externalId                The id of the user across data sources for this Tenant
 * @param  {Number}     tenantId                  The id of the tenant the user belongs to
 * @param  {String}     name                      If available, a name for this user. Different campus systems may provide different
 *                                                names for the same user; which is stored here is undefined.
 * @param  {Function}   callback                  Standard callback function
 * @param  {Object}     callback.err              An error object, if any
 * @param  {User}       callback.user             The retrieved or created user
 */
var getOrCreateUser = module.exports.getOrCreateUser = function(externalId, tenantId, name, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    externalId: Joi.string().required(),
    tenantId: Joi.number().required(),
    name: [Joi.string().optional(), Joi.allow(null)]
  });
  var validationResult = Joi.validate({
    externalId: externalId,
    tenantId: tenantId,
    name: name
  }, validationSchema);
  if (validationResult.error) {
    return callback({code: 400, msg: validationResult.error.details[0].message});
  }
  // Get the user from the DB or create it if it doesn't exist yet
  var options = {
    where: {
      external_id: externalId,
      tenant_id: tenantId
    },
    defaults: {
      name: name
    }
  };
  DB.User.findOrCreate(options).complete(function(err, data) {
    if (err) {
      log.error({err: err}, 'Failed to get or create a user');
      return callback({code: 500, msg: err.message});
    }
    var user = data[0];
    var wasCreated = data[1];
    if (wasCreated) {
      log.info({id: user.id}, 'Created a new user');
    }
    return callback(null, user);
  });
};

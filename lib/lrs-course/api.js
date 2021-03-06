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
var log = require('../lrs-core/logger')('lrs-course');

/**
 * Get a course. If the course doesn't exist yet, it will be created
 *
 * @param  {Number}       canvasCourseId                    The id of the course in Canvas
 * @param  {Canvas}       canvas                            The Canvas instance the course is running on
 * @param  {Object}       courseInfo                        Additional info for the course
 * @param  {String}       [courseInfo.name]                 The name of the course
 * @param  {String}       [courseInfo.privacydashboard_url] The URL where the dashboard in this course can be reached
 * @param  {Function}     callback                          Standard callback function
 * @param  {Object}       callback.err                      An error object, if any
 * @param  {Course}       callback.course                   The retrieved or created course
 */
var getOrCreateCourse = module.exports.getOrCreateCourse = function(canvasCourseId, canvas, courseInfo, callback) {
  // Parameter validation
  var validationSchema = Joi.object().keys({
    canvasCourseId: Joi.number().required(),
    canvas: Joi.object().required(),
    courseInfo: Joi.object().keys({
      name: Joi.string().optional(),
      privacydashboard_url: Joi.string().optional()
    }).optional()
  });

  var validationResult = Joi.validate({
    canvasCourseId: canvasCourseId,
    canvas: canvas,
    courseInfo: courseInfo
  }, validationSchema);

  if (validationResult.error) {
    return callback({code: 400, msg: validationResult.error.details[0].message});
  }

  // Get the course for a particular tenant from the DB or create it if it doesn't exist yet
  options = {
    where: {
      canvas_course_id: canvasCourseId,
      tenant_id: canvas.id
    },
    defaults: {
      name: courseInfo.name,
      privacydashboard_url: courseInfo.privacydashboard_url
    }
  };
  DB.Course.findOrCreate(options).complete(function(err, data) {
    if (err) {
      log.error({err: err}, 'Failed to get or create a course');
      return callback({code: 500, msg: err.message});
    }

    var course = data[0];
    var wasCreated = data[1];

    if (wasCreated) {
      log.info({id: course.id}, 'Created a new course');
      return callback(null, course);
    } else {
      course.update(courseInfo).complete(function(err, course) {
        if (err) {
          log.error({err: err}, 'Failed to update a course');
          return callback({code: 500, msg: err.message});
        }

        return callback(null, course);
      });
    }
  });
};

/**
 * Get a course by its id
 *
 * @param  {Number}       id                  The id of the course
 * @param  {Function}     callback            Standard callback function
 * @param  {Object}       callback.err        An error object, if any
 * @param  {Course}       callback.course     The retrieved course
 */
var getCourse = module.exports.getCourse = function(id, callback) {
  var options = {
    include: [
      {
        model: DB.Tenant,
        as: 'tenant'
      }
    ]
  };
  DB.Course.findByPk(id, options).complete(function(err, course) {
    if (err) {
      log.error({err: err, course: id}, 'Failed to get a course');
      return callback({code: 500, msg: err.message});
    } else if (!course) {
      log.error({err: err, id: id}, 'Failed to retrieve the course');
      return callback({code: 404, msg: 'Failed to retrieve the course'});
    }

    return callback(null, course);
  });
};

/**
 * Get public attributes (i.e. safe to expose over API) for a given course
 *
 * @param  {Number}       canvasCourseId         The id of the course in Canvas
 * @param  {Number}       tenantId                 The Canvas instance the course is running on
 * @param  {Function}     callback               Standard callback function
 * @param  {Object}       callback.err           An error object, if any
 * @param  {Course}       callback.course        The retrieved course
 */
var getCoursePublic = module.exports.getCoursePublic = function(canvasCourseId, tenantId, callback) {

  // Parameter validation
  var validationSchema = Joi.object().keys({
    canvasCourseId: Joi.number().required(),
    tenantId: Joi.number().required()
  });

  var validationResult = Joi.validate({
    canvasCourseId: canvasCourseId,
    tenantId: tenantId
  }, validationSchema);

  if (validationResult.error) {
    return callback({code: 400, msg: validationResult.error.details[0].message});
  }

  var options = {
    where: {
      canvas_course_id: canvasCourseId,
      tenant_id: tenantId
    },
    attributes: [
      'id',
      'name',
      'canvas_course_id',
      'active',
      'privacydashboard_url'
    ]
  };
  DB.Course.findOne(options).complete(function(err, course) {
    if (err) {
      log.error({err: err, course_id: canvasCourseId}, 'Failed to get a course');
      return callback({code: 500, msg: err.message});
    } else if (!course) {
      log.error({err: err, course_id: canvasCourseId}, 'Failed to retrieve the course');
      return callback({code: 404, msg: 'Failed to retrieve the course'});
    }

    return callback(null, course);
  });
};

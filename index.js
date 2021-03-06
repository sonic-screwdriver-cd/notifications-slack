'use strict';

const Joi = require('joi');
const slacker = require('./slack');
const NotificationBase = require('screwdriver-notifications-base');

const COLOR_MAP = {
    SUCCESS: 'good',
    FAILURE: 'danger',
    ABORTED: 'danger',
    // https://github.com/screwdriver-cd/ui/blob/master/app/styles/screwdriver-colors.scss
    RUNNING: '#0F69FF',
    QUEUED: '#0F69FF'
};
const STATUSES_MAP = {
    SUCCESS: ':sunny:',
    FAILURE: ':umbrella:',
    ABORTED: ':cloud:',
    RUNNING: ':runner:',
    QUEUED: ':cyclone:'
};
const DEFAULT_STATUSES = ['FAILURE'];
const SCHEMA_STATUS = Joi.string().valid(Object.keys(COLOR_MAP));
const SCHEMA_STATUSES = Joi.array()
    .items(SCHEMA_STATUS)
    .min(0);
const SCHEMA_SLACK_CHANNEL = Joi.string().required();
const SCHEMA_SLACK_CHANNELS = Joi.array()
    .items(SCHEMA_SLACK_CHANNEL)
    .min(1);
const SCHEMA_SLACK_SETTINGS = Joi.object().keys({
    slack: Joi.alternatives().try(
        Joi.object().keys({
            channels: SCHEMA_SLACK_CHANNELS,
            statuses: SCHEMA_STATUSES,
            minimized: Joi.boolean()
        }),
        SCHEMA_SLACK_CHANNELS, SCHEMA_SLACK_CHANNEL
    ).required()
}).unknown(true);
const SCHEMA_SCM_REPO = Joi.object()
    .keys({
        name: Joi.string().required()
    }).unknown(true);
const SCHEMA_PIPELINE_DATA = Joi.object()
    .keys({
        scmRepo: SCHEMA_SCM_REPO.required()
    }).unknown(true);
const SCHEMA_BUILD_DATA = Joi.object()
    .keys({
        settings: SCHEMA_SLACK_SETTINGS.required(),
        status: SCHEMA_STATUS.required(),
        pipeline: SCHEMA_PIPELINE_DATA.required(),
        jobName: Joi.string(),
        build: Joi.object().keys({
            id: Joi.number().integer().required()
        }).unknown(true),
        event: Joi.object(),
        buildLink: Joi.string()
    });
const SCHEMA_SLACK_CONFIG = Joi.object()
    .keys({
        token: Joi.string().required()
    });

class SlackNotifier extends NotificationBase {
    /**
    * Constructs an SlackNotifier
    * @constructor
    * @param {object} config - Screwdriver config object initialized in API
    */
    constructor(config) {
        super(...arguments);
        this.config = Joi.attempt(config, SCHEMA_SLACK_CONFIG,
            'Invalid config for slack notifications');
    }
    /**
    * Sets listener on server event of name 'eventName' in Screwdriver
    * Currently, event is triggered with a build status is updated
    * @method _notify
    * @param {Object} buildData - Build data emitted with some event from Screwdriver
    */
    _notify(buildData) {
        // Check buildData format against SCHEMA_BUILD_DATA
        try {
            Joi.attempt(buildData, SCHEMA_BUILD_DATA, 'Invalid build data format');
        } catch (e) {
            return;
        }
        if (Object.keys(buildData.settings).length === 0) {
            return;
        }
        if (typeof buildData.settings.slack === 'string' ||
            Array.isArray(buildData.settings.slack)) {
            buildData.settings.slack = (typeof buildData.settings.slack === 'string')
                ? [buildData.settings.slack]
                : buildData.settings.slack;
            buildData.settings.slack = {
                channels: buildData.settings.slack,
                statuses: DEFAULT_STATUSES,
                minimized: false
            };
        }
        if (buildData.settings.slack.statuses === undefined) {
            buildData.settings.slack.statuses = DEFAULT_STATUSES;
        }

        if (!buildData.settings.slack.statuses.includes(buildData.status)) {
            return;
        }
        const pipelineLink = buildData.buildLink.split('/builds')[0];
        const truncatedSha = buildData.event.sha.slice(0, 6);
        const cutOff = 150;
        const commitMessage = buildData.event.commit.message.length > cutOff ?
            `${buildData.event.commit.message.substring(0, cutOff)}...` :
            buildData.event.commit.message;
        const isMinimized = buildData.settings.slack.minimized;
        const message = isMinimized ?
            // eslint-disable-next-line max-len
            `<${pipelineLink}|${buildData.pipeline.scmRepo.name}#${buildData.jobName}> *${buildData.status}*` :
            // eslint-disable-next-line max-len
            `*${buildData.status}* ${STATUSES_MAP[buildData.status]} <${pipelineLink}|${buildData.pipeline.scmRepo.name} ${buildData.jobName}>`;
        const attachments = isMinimized ?
            [
                {
                    fallback: '',
                    color: COLOR_MAP[buildData.status],
                    fields: [
                        {
                            title: 'Build',
                            value: `<${buildData.buildLink}|#${buildData.build.id}>`,
                            short: true
                        }
                    ]
                }
            ] :
            [
                {
                    fallback: '',
                    color: COLOR_MAP[buildData.status],
                    title: `#${buildData.build.id}`,
                    title_link: `${buildData.buildLink}`,
                    // eslint-disable-next-line max-len
                    text: `${commitMessage} (<${buildData.event.commit.url}|${truncatedSha}>)` +
                            `\n${buildData.event.causeMessage}`
                }
            ];
        const slackMessage = {
            message,
            attachments
        };

        slacker(this.config.token, buildData.settings.slack.channels, slackMessage);
    }
}

module.exports = SlackNotifier;

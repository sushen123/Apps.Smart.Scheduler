import {
    IHttp,
    IPersistence,
} from "@rocket.chat/apps-engine/definition/accessors";
import { IUser } from "@rocket.chat/apps-engine/definition/users";
import { PREFFERED_ARGS_KEY } from "../constants/keys";
import {
    COMMON_TIME_PROMPT,
    RECOMMENDED_COMMON_TIME_PROMPT,
} from "../constants/prompts";
import {
    constructFreeBusyPrompt,
    constructPreferredDateTimePrompt,
} from "../core/prompts";
import { ICommonTimeString } from "../definitions/ICommonTime";
import { IConstraintArgs } from "../definitions/IConstraintArgs";
import { IFreeBusyResponse } from "../definitions/IFreeBusyResponse";
import { IMeetingArgs } from "../definitions/IMeetingArgs";
import { storeData } from "../lib/dataStore";
import { sendNotification } from "../lib/messages";
import { SmartSchedulingApp } from "../SmartSchedulingApp";
import { getConstraints } from "./googleCalendar";

export async function generateChatCompletions(
    app: SmartSchedulingApp,
    http: IHttp,
    body: object
): Promise<string> {
    // const model = await app
    //     .getAccessors()
    //     .environmentReader.getSettings()
    //     .getValueById("model");
    // const url = `http://${model}/v1` + "/chat/completions";
    // body = {
    //     ...body,
    //     model: model,
    //     temperature: 0,
    // };

    const model = "mistral";
    const url = "http://host.docker.internal:11434/api/chat";
    body = {
        ...body,
        model: model,
        temperature: 0,
        options: { temperature: 0 },
        stream: false,
    };

    app.getLogger().debug(
        `Request to ${url} with payload: ${JSON.stringify(body)}`
    );

    const response = await http.post(url, {
        headers: {
            "Content-Type": "application/json",
        },
        content: JSON.stringify(body),
    });

    app.getLogger().debug(`Response from ${url}: ${JSON.stringify(response)}`);

    if (!response || !response.content) {
        throw new Error(
            "Something is wrong with the API. Please try again later"
        );
    }

    try {
        return JSON.parse(response.content).message.content;
        // return JSON.parse(response.content).choices[0].message.content;
    } catch (error) {
        app.getLogger().error(`Error parsing response: ${error}`);
        throw new Error(`Invalid response from API: ${response}`);
    }
}

export async function generatePreferredDateTime(
    app: SmartSchedulingApp,
    http: IHttp,
    utcOffset: number,
    prompt: string
): Promise<string> {
    const body = {
        messages: [
            {
                role: "system",
                content: constructPreferredDateTimePrompt(utcOffset, prompt),
            },
        ],
    };

    const response = await generateChatCompletions(app, http, body);
    return response;
}

export async function generateCommonTime(
    app: SmartSchedulingApp,
    http: IHttp,
    constraintPrompt: string
): Promise<string> {
    // return `2024-09-09T02:30:00Z to 2024-09-09T03:00:00Z`;
    const body = {
        messages: [
            {
                role: "system",
                content: constraintPrompt,
            },
        ],
    };

    const response = await generateChatCompletions(app, http, body);
    return response;
}

export async function getConstraintArguments(
    app: SmartSchedulingApp,
    http: IHttp,
    prompt: string
): Promise<IConstraintArgs> {
    const body = {
        messages: [
            {
                role: "system",
                content: `Turn this prompt: 
                ${prompt}
                Into the following format, example:
                {
                    "preferredDate": "2021-12-31", // YYYY-MM-DD
                    "timeMin": "09:00:00", // HH:MM:SS
                    "timeMax": "17:00:00", // HH:MM:SS
                }`,
            },
        ],
        format: "json",
    };

    const response = await generateChatCompletions(app, http, body);
    const args: IConstraintArgs = JSON.parse(response);
    return args;
}

export async function getMeetingArguments(
    app: SmartSchedulingApp,
    http: IHttp,
    prompt: string
): Promise<IMeetingArgs> {
    const body = {
        messages: [
            {
                role: "system",
                content: `Turn this prompt: 
                ${prompt}
                Into array of item using following format, example:
                {
                    "participants": ["email@example.com", "second.email@example.com"], // Array of emails
                    "datetimeStart": "2021-12-31T09:00:00Z", // Meeting start. Use ISO 8601 format
                    "datetimeEnd": "2021-12-31T17:00:00Z", // Meeting end. Use ISO 8601 format
                }
                Do not output any other information. Only use the fields above.    
                `,
            },
        ],
        format: "json",
    };

    const response = await generateChatCompletions(app, http, body);
    const args: IMeetingArgs = JSON.parse(response);

    return args;
}

export async function generateConstraintPrompt(
    app: SmartSchedulingApp,
    http: IHttp,
    user: IUser,
    prompt: string,
    persistence: IPersistence,
    // DEBUG
    read: any,
    modify: any,
    room: any
): Promise<IConstraintArgs> {
    const preferredDateTime = await generatePreferredDateTime(
        app,
        http,
        user.utcOffset,
        prompt
    );

    // DEBUG
    await sendNotification(
        read,
        modify,
        user,
        room,
        `Prompt: ${prompt}
        -----------
        Preferred date time: 
        ${preferredDateTime}\n`
    );

    const args = await getConstraintArguments(app, http, preferredDateTime);

    await storeData(persistence, user.id, PREFFERED_ARGS_KEY, args);

    // DEBUG
    await sendNotification(
        read,
        modify,
        user,
        room,
        `Args: ${JSON.stringify(args)} \n`
    );

    return args;
}

export async function generatePromptForLLM(
    app: SmartSchedulingApp,
    http: IHttp,
    user: IUser,
    emails: string[],
    args: IConstraintArgs
): Promise<string> {
    const constraints = (await getConstraints(
        app,
        http,
        user,
        emails,
        args.preferredDate
    ).then((res) => res)) as IFreeBusyResponse;

    const constraintPrompt = constructFreeBusyPrompt(args, user, constraints);
    return COMMON_TIME_PROMPT.replace("{prompt}", constraintPrompt);
}

export async function generatePromptForAlgorithm(
    app: SmartSchedulingApp,
    http: IHttp,
    user: IUser,
    emails: string[],
    args: IConstraintArgs
): Promise<string> {
    const constraints = (await getConstraints(
        app,
        http,
        user,
        emails,
        args.preferredDate
    ).then((res) => res)) as IFreeBusyResponse;

    const constraintPrompt = constructFreeBusyPrompt(args, user, constraints);
    return constraintPrompt;
}

export async function getRecommendedTime(
    app: SmartSchedulingApp,
    http: IHttp,
    prompt: string,
    commonTimes: ICommonTimeString[]
): Promise<string> {
    let commonTimePrompt = "";
    commonTimes.forEach((commonTime, index) => {
        commonTimePrompt += `${
            index + 1
        }. Participants: ${commonTime.participants.join(", ")}
        Time: ${commonTime.time[0]} to ${commonTime.time[1]}
        ----------------`;
    });

    const body = {
        messages: [
            {
                role: "system",
                content: RECOMMENDED_COMMON_TIME_PROMPT.replace(
                    "{prompt}",
                    prompt
                ).replace("{common_time}", commonTimePrompt),
            },
        ],
    };

    const response = await generateChatCompletions(app, http, body);
    return response;
}

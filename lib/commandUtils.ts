import {
    IHttp,
    IModify,
    IPersistence,
    IRead,
} from "@rocket.chat/apps-engine/definition/accessors";
import { IRoom } from "@rocket.chat/apps-engine/definition/rooms";
import { SlashCommandContext } from "@rocket.chat/apps-engine/definition/slashcommands";
import { IUser } from "@rocket.chat/apps-engine/definition/users";
import { SmartSchedulingApp } from "../SmartSchedulingApp";
import { IExecutorProps } from "../definitions/IExecutorProps";

import { authorize } from "../modals/authModal";
import { promptModal } from "../modals/promptModal";
import { sendNotification } from "./messages";

export class CommandUtility {
    sender: IUser;
    room: IRoom;
    command: string[];
    context: SlashCommandContext;
    read: IRead;
    modify: IModify;
    http: IHttp;
    persistence: IPersistence;
    app: SmartSchedulingApp;

    constructor(props: IExecutorProps) {
        this.sender = props.sender;
        this.room = props.room;
        this.command = props.command;
        this.context = props.context;
        this.read = props.read;
        this.modify = props.modify;
        this.http = props.http;
        this.persistence = props.persistence;
        this.app = props.app;
    }

    public async resolveCommand() {
        const commandLength = this.command.length;
        if (commandLength === 1) {
            switch (this.command[0]) {
                case "authorize": {
                    authorize(
                        this.app,
                        this.read,
                        this.modify,
                        this.sender,
                        this.room,
                        this.persistence
                    );
                }
                case "help": {
                    // TODO: Implement help command
                }
                default: {
                    await sendNotification(
                        this.read,
                        this.modify,
                        this.sender,
                        this.room,
                        "Invalid command"
                    );
                }
            }
        } else {
            const triggerId = this.context.getTriggerId() as string;
            const user = this.context.getSender();

            const modal = await promptModal({
                modify: this.modify,
                read: this.read,
                persistence: this.persistence,
                http: this.http,
                slashCommandContext: this.context,
                uiKitContext: undefined,
            });

            await this.modify
                .getUiController()
                .openModalView(modal, { triggerId }, user);
        }
    }
}

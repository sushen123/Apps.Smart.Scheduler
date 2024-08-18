import {
    IHttp,
    IModify,
    IPersistence,
    IRead,
} from "@rocket.chat/apps-engine/definition/accessors";
import { SlashCommandContext } from "@rocket.chat/apps-engine/definition/slashcommands";
import { UIKitInteractionContext } from "@rocket.chat/apps-engine/definition/uikit/UIKitInteractionContext";
import { IUIKitModalViewParam } from "@rocket.chat/apps-engine/definition/uikit/UIKitInteractionResponder";
import { TextObjectType } from "@rocket.chat/apps-engine/definition/uikit/blocks";
import { ModalEnum } from "../constants/enums";
import { IParticipantProps } from "../definitions/IParticipantProps";
import {
    getInteractionRoomData,
    storeInteractionRoomData,
} from "../lib/roomInteraction";

export async function promptModal({
    modify,
    read,
    persistence,
    http,
    slashCommandContext,
    uiKitContext,
}: {
    modify: IModify;
    read: IRead;
    persistence: IPersistence;
    http: IHttp;
    slashCommandContext?: SlashCommandContext;
    uiKitContext?: UIKitInteractionContext;
}): Promise<IUIKitModalViewParam> {
    const room =
        slashCommandContext?.getRoom() ||
        uiKitContext?.getInteractionData().room;
    const user =
        slashCommandContext?.getSender() ||
        uiKitContext?.getInteractionData().user;

    let participantOptions: IParticipantProps[] = Array();
    if (user?.id) {
        let roomId: string;

        if (room?.id) {
            roomId = room.id;
            await storeInteractionRoomData(persistence, user.id, roomId);
        } else {
            roomId = (
                await getInteractionRoomData(
                    read.getPersistenceReader(),
                    user.id
                )
            ).roomId;
        }

        const members = await read.getRoomReader().getMembers(roomId);
        for (const member of members) {
            if (member.id !== user.id) {
                participantOptions.push({
                    text: {
                        type: TextObjectType.MARKDOWN,
                        text: `${member.name} - @${member.username} - ${member.emails[0].address}`,
                    },
                    value: member.emails[0].address,
                });
            }
        }

        participantOptions.sort((a, b) => {
            return a.text.text.toUpperCase() < b.text.text.toUpperCase()
                ? -1
                : 1;
        });
    }

    const blocks = modify.getCreator().getBlockBuilder();

    blocks.addSectionBlock({
        blockId: "guideBlockId",
        text: blocks.newMarkdownTextObject(
            `
            **In your prompt, you have to include:**
            1. The preferred day (today, tomorrow, next Monday, etc.). If you already know the exact date, you can put that as well.
            2. The preferred time (early morning, late afternoon, etc.).

            **Example:**
            Schedule a brainstorming session for next Tuesday. We need to discuss the new project timeline. Late morning is preferable.
            `
        ),
    });

    blocks.addInputBlock({
        blockId: "promptBlockId",
        label: {
            text: "Prompt:",
            type: TextObjectType.PLAINTEXT,
        },
        element: blocks.newPlainTextInputElement({
            actionId: "promptBlockId",
            placeholder: {
                text: "Let's do a strategy alignment call next Thursday. Early afternoon is preferable.",
                type: TextObjectType.PLAINTEXT,
            },
        }),
    });

    blocks.addInputBlock({
        blockId: "participantsBlockId",
        label: {
            type: TextObjectType.PLAINTEXT,
            text: "Participants:",
            emoji: true,
        },
        element: blocks.newMultiStaticElement({
            actionId: "participantsBlockId",
            placeholder: {
                type: TextObjectType.PLAINTEXT,
                text: "Select 1 or more participants",
            },
            options: participantOptions,
        }),
    });

    return {
        id: ModalEnum.PROMPT_MODAL,
        title: blocks.newPlainTextObject("Schedule your meeting"),
        submit: blocks.newButtonElement({
            text: blocks.newPlainTextObject("Schedule"),
        }),
        blocks: blocks.getBlocks(),
    };
}

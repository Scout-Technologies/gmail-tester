const gmail = require("./gmail");
const tokenStore = require("./token-store");
const { google } = require("googleapis");

function _get_header(name, headers) {
  const found = headers.find(h => h.name === name);
  return found && found.value;
}

function _init_query(options) {
  const { to, from, subject, before, after } = options;
  let query = "";
  if (to) {
    query += `to:"${to}" `;
  }
  if (from) {
    query += `from:"${from}" `;
  }
  if (subject) {
    query += `subject:(${subject}) `;
  }
  if (after) {
    const after_epoch = Math.round(new Date(after).getTime() / 1000);
    query += `after:${after_epoch} `;
  }
  if (before) {
    const before_epoch = Math.round(new Date(before).getTime() / 1000);
    query += `before:${before_epoch} `;
  }
  query = query.trim();
  return query;
}

async function _get_recent_email(credentials, token, options = {}) {
  const emails = [];

  const query = _init_query(options);
  // Load client secrets from a local file.
  const oAuth2Client = await gmail.authorize(credentials, token);
  const gmail_emails = await gmail.get_recent_email(
    oAuth2Client,
    query,
    options.label
  );
  for (const gmail_email of gmail_emails) {
    const email = {
      from: _get_header("From", gmail_email.payload.headers),
      subject: _get_header("Subject", gmail_email.payload.headers),
      receiver: _get_header("Delivered-To", gmail_email.payload.headers),
      date: new Date(+gmail_email["internalDate"]),
      threadId: gmail_email.threadId,
      // Check for both Message-ID and Message-Id formats
      messageId:
        _get_header("Message-ID", gmail_email.payload.headers) ||
        _get_header("Message-Id", gmail_email.payload.headers)
    };
    if (options.include_body) {
      let email_body = {
        html: "",
        text: ""
      };
      const { body } = gmail_email.payload;
      if (body.size) {
        switch (gmail_email.payload.mimeType) {
          case "text/html":
            email_body.html = Buffer.from(body.data, "base64").toString("utf8");
            break;
          case "text/plain":
          default:
            email_body.text = Buffer.from(body.data, "base64").toString("utf8");
            break;
        }
      } else {
        let parts = [...gmail_email.payload.parts];
        while (parts.length) {
          let part = parts.shift();

          if (part.parts) {
            parts = parts.concat(part.parts);
          }

          if (part.mimeType === "text/plain") {
            email_body.text = Buffer.from(part.body.data, "base64").toString(
              "utf8"
            );
          } else if (part.mimeType === "text/html") {
            email_body.html = Buffer.from(part.body.data, "base64").toString(
              "utf8"
            );
          }
        }
      }

      email.body = email_body;
    }

    if (options.include_attachments) {
      email.attachments = await gmail.get_email_attachments(
        oAuth2Client,
        gmail_email
      );
    }
    emails.push(email);
  }
  return emails;
}

async function __check_inbox(credentials, token, options = {}) {
  const { subject, from, to, wait_time_sec, max_wait_time_sec } = options;
  try {
    console.log(
      `[gmail] Checking for message from '${from}', to: ${to}, contains '${subject}' in subject...`
    );
    let found_emails = null;
    let done_waiting_time = 0;
    do {
      const emails = await _get_recent_email(credentials, token, options);
      if (emails.length > 0) {
        console.log(`[gmail] Found!`);
        found_emails = emails;
        break;
      }
      console.log(
        `[gmail] Message not found. Waiting ${wait_time_sec} seconds...`
      );
      done_waiting_time += wait_time_sec;
      if (done_waiting_time >= max_wait_time_sec) {
        console.log("[gmail] Maximum waiting time exceeded!");
        break;
      }
      await new Promise(resolve => setTimeout(resolve, wait_time_sec * 1000));
    } while (!found_emails);
    return found_emails;
  } catch (err) {
    console.log("[gmail] Error:", err);
    throw err;
  }
}

/**
 * Poll inbox.
 *
 * @param {string | Object} credentials - Path to credentials json file or credentials Object.
 * @param {string | Object} token - Path to token json file or token Object.
 * @param {CheckInboxOptions} [options]
 * @param {boolean} [options.include_body] - Set to `true` to fetch decoded email bodies.
 * @param {string} [options.from] - Filter on the email address of the receiver.
 * @param {string} [options.to] - Filter on the email address of the sender.
 * @param {string} [options.subject] - Filter on the subject of the email.
 * @param {Date} [options.before] - Date. Filter messages received _after_ the specified date.
 * @param {Date} [options.after] - Date. Filter messages received _before_ the specified date.
 * @param {number} [options.wait_time_sec] - Interval between inbox checks (in seconds). Default: 30 seconds.
 * @param {number} [options.max_wait_time_sec] - Maximum wait time (in seconds). When reached and the email was not found, the script exits. Default: 60 seconds.
 * @param {string} [options.label] - String. The default label is 'INBOX', but can be changed to 'SPAM', 'TRASH' or a custom label. For a full list of built-in labels, see https://developers.google.com/gmail/api/guides/labels?hl=en
 */
async function check_inbox(
  credentials,
  token,
  options = {
    subject: undefined,
    from: undefined,
    to: undefined,
    wait_time_sec: 30,
    max_wait_time_sec: 30,
    include_body: false,
    label: "INBOX"
  }
) {
  if (typeof options !== "object") {
    console.error(
      "[gmail-tester] This functionality is obsolete! Please pass all params of check_inbox() in options object."
    );
    process.exit(1);
  }
  return __check_inbox(credentials, token, options);
}

/**
 * Get an array of messages
 *
 * @param {string | Object} credentials - Path to credentials json file or credentials Object.
 * @param {string | Object} token - Path to token json file or token Object.
 * @param {GetMessagesOptions} options
 * @param {boolean} options.include_body - Return message body string.
 * @param {string} options.from - Filter on the email address of the receiver.
 * @param {string} options.to - Filter on the email address of the sender.
 * @param {string} options.subject - Filter on the subject of the email.
 * @param {Object} options.before - Date. Filter messages received _after_ the specified date.
 * @param {Object} options.after - Date. Filter messages received _before_ the specified date.
 */
async function get_messages(credentials, token, options) {
  try {
    return await _get_recent_email(credentials, token, options);
  } catch (err) {
    console.log("[gmail] Error:", err);
  }
}

/**
 * Refreshes Access Token
 *
 * @param {string | Object} credentials - Path to credentials json file or credentials Object.
 * @param {string | Object} token - Path to token json file or token Object.
 */
async function refresh_access_token(credentials, token) {
  const oAuth2Client = await gmail.authorize(credentials, token);
  const refresh_token_result = await oAuth2Client.refreshToken(
    oAuth2Client.credentials.refresh_token
  );
  if (refresh_token_result && refresh_token_result.tokens) {
    const new_token = tokenStore.get(token);
    if (refresh_token_result.tokens.access_token) {
      new_token.access_token = refresh_token_result.tokens.access_token;
    }
    if (refresh_token_result.tokens.refresh_token) {
      new_token.refresh_token = refresh_token_result.tokens.refresh_token;
    }
    if (refresh_token_result.tokens.expiry_date) {
      new_token.expiry_date = refresh_token_result.tokens.expiry_date;
    }
    tokenStore.store(new_token, token);
  } else {
    throw new Error(
      `Refresh access token failed! Respose: ${JSON.stringify(
        refresh_token_result
      )}`
    );
  }
}

/**
 * Replies to the most recent email that matches the given criteria.
 *
 * @param {string | Object} credentials - Path to credentials json file or credentials object.
 * @param {string | Object} token - Path to token json file or token object.
 * @param {Object} options - Filtering options similar to check_inbox.
 * @param {string} options.subject - Filter on the subject of the email.
 * @param {string} [options.from] - Filter on the email address of the sender.
 * @param {string} [options.to] - Filter on the email address of the receiver.
 * @param {Date} [options.before] - Filter messages received before this date.
 * @param {Date} [options.after] - Filter messages received after this date.
 * @param {number} [options.wait_time_sec=30] - Interval between inbox checks (in seconds).
 * @param {number} [options.max_wait_time_sec=60] - Maximum wait time (in seconds).
 * @param {string} [options.label="INBOX"] - Gmail label to search in.
 * @param {string} replyContent - The content of your reply.
 * @returns {Promise<Object>} The response from the Gmail API after sending the reply.
 */
async function reply_to_email(credentials, token, replyContent, options = {}) {
  // Use _get_recent_email to find matching emails.
  // This returns an array of flattened email objects.
  const emails = await _get_recent_email(credentials, token, options);
  if (!emails || emails.length === 0) {
    throw new Error("No email found matching the provided criteria.");
  }

  // Choose the first email that was found.
  const originalEmail = emails[0];

  // Extract properties from the flattened email object.
  const originalFrom = originalEmail.from;
  const originalSubject = originalEmail.subject;
  const threadId = originalEmail.threadId;
  // Get the original message ID for threading
  const originalMessageId = originalEmail.messageId || "";

  if (!originalFrom || !originalSubject || !threadId) {
    throw new Error("Missing required information from the original email.");
  }

  // Log whether we found a message ID for debugging
  if (originalMessageId) {
    console.log(`[gmail-tester] Found original Message-ID: ${originalMessageId}`);
  } else {
    console.log(
      "[gmail-tester] Warning: No Message-ID found in the original email"
    );
  }

  // Prepare the reply subject.
  let replySubject = originalSubject;
  if (!/^Re:/i.test(replySubject)) {
    replySubject = "Re: " + replySubject;
  }

  // Construct the RFC 2822 formatted reply message.
  // "From: me" tells Gmail to use the authenticated user's address.
  const messageLines = [
    `From: me`,
    `To: ${originalFrom}`,
    `Subject: ${replySubject}`
  ];

  // If a message ID is available, include threading headers.
  if (originalMessageId) {
    console.log(
      `[gmail-tester] Adding threading headers with Message-ID: ${originalMessageId}`
    );
    messageLines.push(`In-Reply-To: ${originalMessageId}`);
    messageLines.push(`References: ${originalMessageId}`);
  } else {
    console.log(
      "[gmail-tester] Skipping threading headers due to missing Message-ID"
    );
  }

  messageLines.push("", replyContent);
  const replyMessage = messageLines.join("\n");

  // Encode the message in base64url format.
  const encodedMessage = Buffer.from(replyMessage)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // Authorize and create a Gmail client.
  const oAuth2Client = await require("./gmail").authorize(credentials, token);
  const gmailClient = google.gmail({ version: "v1", auth: oAuth2Client });

  // Send the reply using the original email's threadId.
  const response = await gmailClient.users.messages.send({
    userId: "me",
    resource: {
      raw: encodedMessage,
      threadId: threadId
    }
  });

  return response.data;
}

module.exports = {
  check_inbox,
  get_messages,
  refresh_access_token,
  reply_to_email
};

// class-transformer group for fields only the account owner may see
// (e.g. User.email). Enable it per endpoint with
// @SerializeOptions({ groups: [OWN_ACCOUNT_GROUP] }); without it those
// fields are stripped everywhere, including nested authors/followers.
export const OWN_ACCOUNT_GROUP = 'ownAccount';

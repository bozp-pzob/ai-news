import { TwitterSource } from './TwitterSource';
import { Scraper } from 'agent-twitter-client';

// Mock the agent-twitter-client
jest.mock('agent-twitter-client', () => {
  // Mock the Scraper class
  return {
    Scraper: jest.fn().mockImplementation(() => {
      return {
        getTweet: jest.fn(),
        getUserProfile: jest.fn(),
        // Add any other methods that might be called by TwitterSource
        login: jest.fn().mockResolvedValue(undefined),
        isLoggedIn: jest.fn().mockResolvedValue(true),
        getCookies: jest.fn().mockResolvedValue([]),
        setCookies: jest.fn().mockResolvedValue(undefined),
        getUserIdByScreenName: jest.fn().mockImplementation(async (screenName: string) => {
          if (screenName === 'retweeter') return 'retweeter789';
          if (screenName === 'originalposter') return 'originalUser1';
          if (screenName === 'originalposter2') return 'originalUser2';
          return `${screenName}Id`;
        }),
        getUserTweetsIterator: jest.fn().mockImplementation(async function*() { yield {}; }), // Empty generator
        fetchSearchTweets: jest.fn().mockResolvedValue({ tweets: [], next: null }),
      };
    }),
    SearchMode: {
      Latest: 'Latest', // Or whatever the actual value is
    },
  };
});

describe('TwitterSource.processTweets', () => {
  let twitterSource: TwitterSource;
  let mockScraperInstance: jest.Mocked<Scraper>;

  const baseConfig = {
    name: 'testTwitterSource',
    accounts: ['testuser1'],
    username: 'testUsername',
    password: 'testPassword',
    email: 'testEmail',
    cookies: undefined,
  };

  beforeEach(() => {
    // Create a new instance of Scraper mock for each test
    // and assign it to where TwitterSource will use it.
    // The mockImplementation in jest.mock is for the constructor,
    // this is for the instance methods.
    Scraper.prototype.getTweet = jest.fn();
    Scraper.prototype.getUserProfile = jest.fn();
    Scraper.prototype.isLoggedIn = jest.fn().mockResolvedValue(true); // Ensure it's logged in by default
    
    twitterSource = new TwitterSource(baseConfig);
    // Access the mocked instance used by twitterSource
    // This relies on the fact that the constructor of TwitterSource calls `new Scraper()`
    // and jest.mock replaces that with our mock constructor, which returns a mock instance.
    // To make this more robust, we can grab the instance from the mocked constructor.
    const MockedScraper = Scraper as jest.MockedClass<typeof Scraper>;
    mockScraperInstance = MockedScraper.mock.instances[0] as jest.Mocked<Scraper>;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Helper to call the private method
  const callProcessTweets = async (tweets: any[]) => {
    return (twitterSource as any).processTweets(tweets);
  };

  test('Test Case 1: Profile Image URL Directly on Tweet user object', async () => {
    const tweet = {
      id: 'tweet1',
      text: 'Test tweet 1',
      userId: 'user123',
      username: 'testuser1',
      user: { profile_image_url_https: 'http://example.com/direct_image.jpg' },
      timestamp: Date.now() / 1000,
    };
    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/direct_image.jpg');
    expect(result[0].metadata.authorUserName).toBe('testuser1');
    expect(mockScraperInstance.getUserProfile).not.toHaveBeenCalled();
  });
  
  test('Test Case 1.1: Profile Image URL Directly on Tweet author object (avatar)', async () => {
    const tweet = {
      id: 'tweet1.1',
      text: 'Test tweet 1.1',
      userId: 'user1234',
      username: 'testuser1.1',
      author: { avatar: 'http://example.com/author_avatar.jpg' }, // Using author.avatar
      timestamp: Date.now() / 1000,
    };
    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/author_avatar.jpg');
    expect(result[0].metadata.authorUserName).toBe('testuser1.1');
    expect(mockScraperInstance.getUserProfile).not.toHaveBeenCalled();
  });


  test('Test Case 2: Profile Image URL from Hypothetical getUserProfile', async () => {
    const tweet = {
      id: 'tweet2',
      text: 'Test tweet 2',
      userId: 'user456',
      username: 'testuser2',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getUserProfile.mockResolvedValue({ profile_image_url_https: 'http://example.com/fetched_image.jpg' });

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/fetched_image.jpg');
    expect(result[0].metadata.authorUserName).toBe('testuser2');
    expect(mockScraperInstance.getUserProfile).toHaveBeenCalledWith('user456');
  });

  test('Test Case 3: Retweet - Profile Image of Original Poster (Directly on Original Tweet)', async () => {
    const tweet = {
      id: 'rt1',
      isRetweet: true,
      userId: 'retweeter789',
      username: 'retweeter',
      retweetedStatusId: 'originalTweet1',
      retweetedStatus: {
        id: 'originalTweet1',
        text: 'Original tweet content',
        userId: 'originalUser1',
        username: 'originalposter',
        user: { profile_image_url_https: 'http://example.com/original_direct.jpg' },
        timestamp: Date.now() / 1000,
      },
      timestamp: Date.now() / 1000 + 100,
    };

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/original_direct.jpg');
    expect(result[0].metadata.authorUserName).toBe('originalposter'); // Original poster's username
    expect(result[0].metadata.retweetedByUserName).toBe('retweeter'); // Retweeter's username
    expect(mockScraperInstance.getUserProfile).not.toHaveBeenCalled();
  });

  test('Test Case 4: Retweet - Profile Image of Original Poster (via getUserProfile)', async () => {
    const tweet = {
      id: 'rt2',
      isRetweet: true,
      userId: 'retweeter789',
      username: 'retweeter',
      retweetedStatusId: 'originalTweet2',
      retweetedStatus: { // Original status present but lacks user.profile_image_url_https
        id: 'originalTweet2',
        text: 'Original tweet content',
        userId: 'originalUser2', // userId is present
        username: 'originalposter2',
        timestamp: Date.now() / 1000,
      },
      timestamp: Date.now() / 1000 + 100,
    };
    mockScraperInstance.getUserProfile.mockResolvedValue({ profile_image_url_https: 'http://example.com/original_fetched.jpg' });

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/original_fetched.jpg');
    expect(result[0].metadata.authorUserName).toBe('originalposter2');
    expect(mockScraperInstance.getUserProfile).toHaveBeenCalledWith('originalUser2');
  });
  
  test('Test Case 4.1: Retweet - Fetches missing retweetedStatus, then uses direct image from it', async () => {
    const rawTweet = {
        id: 'rt_fetch_direct',
        isRetweet: true,
        userId: 'retweeterReal',
        username: 'retweeterRealName',
        retweetedStatusId: 'originalTweetFetchedDirect', // ID to fetch
        // retweetedStatus is MISSING
        timestamp: Date.now() / 1000 + 200,
    };
    const fetchedOriginalTweet = {
        id: 'originalTweetFetchedDirect',
        text: 'Fetched original tweet text',
        userId: 'originalUserFetchedDirect',
        username: 'originalUserFetchedDirectName',
        user: { profile_image_url_https: 'http://example.com/fetched_original_direct.jpg' },
        timestamp: Date.now() / 1000,
    };

    mockScraperInstance.getTweet.mockResolvedValue(fetchedOriginalTweet);

    const result = await callProcessTweets([rawTweet]);

    expect(mockScraperInstance.getTweet).toHaveBeenCalledWith('originalTweetFetchedDirect');
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/fetched_original_direct.jpg');
    expect(result[0].metadata.authorUserName).toBe('originalUserFetchedDirectName');
    expect(mockScraperInstance.getUserProfile).not.toHaveBeenCalled();
  });

  test('Test Case 4.2: Retweet - Fetches missing retweetedStatus, then uses getUserProfile for image', async () => {
    const rawTweet = {
        id: 'rt_fetch_indirect',
        isRetweet: true,
        userId: 'retweeterReal2',
        username: 'retweeterRealName2',
        retweetedStatusId: 'originalTweetFetchedIndirect', // ID to fetch
        // retweetedStatus is MISSING
        timestamp: Date.now() / 1000 + 300,
    };
    const fetchedOriginalTweetWithoutImage = { // Original tweet data, but no direct image URL
        id: 'originalTweetFetchedIndirect',
        text: 'Fetched original tweet text (no image)',
        userId: 'originalUserFetchedIndirect',
        username: 'originalUserFetchedIndirectName',
        // NO user.profile_image_url_https
        timestamp: Date.now() / 1000,
    };

    mockScraperInstance.getTweet.mockResolvedValue(fetchedOriginalTweetWithoutImage);
    mockScraperInstance.getUserProfile.mockResolvedValue({ profile_image_url_https: 'http://example.com/fetched_original_indirect.jpg' });

    const result = await callProcessTweets([rawTweet]);

    expect(mockScraperInstance.getTweet).toHaveBeenCalledWith('originalTweetFetchedIndirect');
    expect(mockScraperInstance.getUserProfile).toHaveBeenCalledWith('originalUserFetchedIndirect');
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/fetched_original_indirect.jpg');
    expect(result[0].metadata.authorUserName).toBe('originalUserFetchedIndirectName');
  });


  test('Test Case 5: Profile Image URL Not Available (getUserProfile returns null)', async () => {
    const tweet = {
      id: 'tweet3',
      text: 'Test tweet 3',
      userId: 'user789',
      username: 'testuser3',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getUserProfile.mockResolvedValue(null); // getUserProfile finds no image

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBeUndefined();
    expect(result[0].metadata.authorUserName).toBe('testuser3');
    expect(mockScraperInstance.getUserProfile).toHaveBeenCalledWith('user789');
  });
  
  test('Test Case 5.1: Profile Image URL Not Available (getUserProfile returns empty object)', async () => {
    const tweet = {
      id: 'tweet3.1',
      text: 'Test tweet 3.1',
      userId: 'user7891',
      username: 'testuser31',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getUserProfile.mockResolvedValue({}); // getUserProfile finds no image

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBeUndefined();
    expect(mockScraperInstance.getUserProfile).toHaveBeenCalledWith('user7891');
  });
  
  test('Test Case 5.2: Profile Image URL Not Available (getUserProfile throws error)', async () => {
    const tweet = {
      id: 'tweet3.2',
      text: 'Test tweet 3.2',
      userId: 'user7892',
      username: 'testuser32',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getUserProfile.mockRejectedValue(new Error("API error"));

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBeUndefined();
    expect(mockScraperInstance.getUserProfile).toHaveBeenCalledWith('user7892');
  });


  test('Test Case 6: Quoted Tweet - Profile Image of Main Tweet Poster (direct)', async () => {
    const tweet = {
      id: 'qt1',
      text: 'Quoting another tweet',
      userId: 'quoterUser',
      username: 'quoter',
      user: { profile_image_url_https: 'http://example.com/quoter_image.jpg' },
      isQuoted: true,
      quotedStatusId: 'qStatus1',
      quotedStatus: { // Embedded quoted status
        id: 'qStatus1',
        text: 'Quoted text',
        userId: 'quotedAuthor',
        username: 'quotedauthor',
        user: { profile_image_url_https: 'http://example.com/quoted_author_image.jpg' }, // Quoted author has an image too
        timestamp: Date.now()/1000 - 100
      },
      timestamp: Date.now() / 1000,
    };

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/quoter_image.jpg'); // Main quoter's image
    expect(result[0].metadata.authorUserName).toBe('quoter');
    expect(result[0].metadata.quotedTweet).toBeDefined();
    expect(result[0].metadata.quotedTweet.userName).toBe('quotedauthor');
    // The logic does not add authorProfileImageUrl to quotedTweet metadata, which is fine per requirements.
    expect(mockScraperInstance.getUserProfile).not.toHaveBeenCalled();
  });

  test('Test Case 6.1: Quoted Tweet - Profile Image of Main Tweet Poster (via getUserProfile)', async () => {
    const tweet = {
      id: 'qt2',
      text: 'Quoting another tweet again',
      userId: 'quoterUser2',
      username: 'quoter2',
      // No direct user.profile_image_url_https for quoterUser2
      isQuoted: true,
      quotedStatusId: 'qStatus2',
      // Quoted status could be fetched or embedded, for this test, assume embedded is enough
      quotedStatus: { 
        id: 'qStatus2', text: 'Quoted text 2', userId: 'quotedAuthor2', username: 'quotedauthor2', 
        timestamp: Date.now()/1000 - 50
      },
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getUserProfile.mockResolvedValue({ profile_image_url_https: 'http://example.com/quoter2_fetched_image.jpg' });

    const result = await callProcessTweets([tweet]);
    
    expect(mockScraperInstance.getUserProfile).toHaveBeenCalledWith('quoterUser2');
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/quoter2_fetched_image.jpg');
    expect(result[0].metadata.authorUserName).toBe('quoter2');
    expect(result[0].metadata.quotedTweet).toBeDefined();
  });
  
   test('Test Case 7: Tweet with no user object and no userId (should not attempt getUserProfile)', async () => {
    const tweet = {
      id: 'tweetNoUser',
      text: 'A tweet with missing user info',
      username: 'ghostuser', // username might be present
      // userId is missing
      // user object is missing
      timestamp: Date.now() / 1000,
    };

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBeUndefined();
    expect(result[0].metadata.authorUserName).toBe('ghostuser');
    expect(mockScraperInstance.getUserProfile).not.toHaveBeenCalled();
  });

});

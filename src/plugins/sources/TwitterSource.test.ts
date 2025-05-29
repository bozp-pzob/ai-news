import { TwitterSource } from './TwitterSource';
import { Scraper } from 'agent-twitter-client';

// Mock the agent-twitter-client
jest.mock('agent-twitter-client', () => {
  return {
    Scraper: jest.fn().mockImplementation(() => {
      return {
        getTweet: jest.fn(),
        getProfile: jest.fn(), // Changed from getUserProfile to getProfile
        login: jest.fn().mockResolvedValue(undefined),
        isLoggedIn: jest.fn().mockResolvedValue(true),
        getCookies: jest.fn().mockResolvedValue([]),
        setCookies: jest.fn().mockResolvedValue(undefined),
        getUserIdByScreenName: jest.fn().mockImplementation(async (screenName: string) => {
          // This mock might still be needed if getUserIdByScreenName is used elsewhere,
          // but for processTweets, username is taken directly from tweetToProcessForContent.
          if (screenName === 'retweeter') return 'retweeter789';
          if (screenName === 'originalposter') return 'originalUser1';
          if (screenName === 'originalposter2') return 'originalUser2';
          return `${screenName}Id`;
        }),
        getUserTweetsIterator: jest.fn().mockImplementation(async function*() { yield {}; }),
        fetchSearchTweets: jest.fn().mockResolvedValue({ tweets: [], next: null }),
      };
    }),
    SearchMode: {
      Latest: 'Latest',
    },
  };
});

describe('TwitterSource.processTweets', () => {
  let twitterSource: TwitterSource;
  let mockScraperInstance: jest.Mocked<Scraper>;

  const baseConfig = {
    name: 'testTwitterSource',
    accounts: ['testuser_config'], // Changed to avoid collision with test data
    username: 'testUsername_config',
    password: 'testPassword_config',
    email: 'testEmail_config',
    cookies: undefined,
  };

  beforeEach(() => {
    // Reset all mocks including constructor calls for Scraper
    jest.clearAllMocks();

    // Create a new instance of Scraper mock for each test
    // Scraper.prototype.getProfile is now part of the main mock via jest.fn() in the factory
    // So, we just need to ensure we get the correct instance.
    twitterSource = new TwitterSource(baseConfig);
    const MockedScraper = Scraper as jest.MockedClass<typeof Scraper>;
    // Assuming TwitterSource constructor creates one Scraper instance
    // If it creates more, this might need adjustment or a more specific way to get the instance.
    if (MockedScraper.mock.instances.length > 0) {
        mockScraperInstance = MockedScraper.mock.instances[MockedScraper.mock.instances.length -1] as jest.Mocked<Scraper>;
    } else {
        // Fallback if constructor wasn't called as expected (e.g. if init isn't called in test path)
        // This shouldn't happen if TwitterSource always instantiates Scraper.
        // Forcing a new instance for safety, though ideally the above works.
        mockScraperInstance = new (Scraper as any)() as jest.Mocked<Scraper>;
    }
    
    // Ensure specific method mocks are fresh if needed, though jest.clearAllMocks should handle it.
    // mockScraperInstance.getProfile = jest.fn(); // This is now done by the factory mock.
    // mockScraperInstance.getTweet = jest.fn(); // Also handled by factory mock.
  });

  // Helper to call the private method
  const callProcessTweets = async (tweets: any[]) => {
    // Temporarily make isLoggedIn return true if not already mocked for the instance
    if (!mockScraperInstance.isLoggedIn) {
        mockScraperInstance.isLoggedIn = jest.fn().mockResolvedValue(true);
    }
    // Ensure init() is called if it's relevant to setting up the client for processTweets
    // For now, assuming client is ready or processTweets doesn't depend on init state not covered by mocks
    return (twitterSource as any).processTweets(tweets);
  };

  test('Scenario 1: Profile Image URL Successfully Fetched by getProfile (profile_image_url_https)', async () => {
    const tweet = {
      id: 'tweet1',
      text: 'Test tweet 1',
      userId: 'user123',
      username: 'testuser1',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getProfile.mockResolvedValue({ 
      profile_image_url_https: 'http://example.com/profile.jpg',
      name: 'Test User 1',
      // other fields that might be on a profile object
    });

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/profile.jpg');
    expect(result[0].metadata.authorUserName).toBe('testuser1');
    expect(mockScraperInstance.getProfile).toHaveBeenCalledWith('testuser1');
  });

  test('Scenario 2: Profile Image URL Successfully Fetched by getProfile (profileImageUrl as fallback)', async () => {
    const tweet = {
      id: 'tweet2',
      text: 'Test tweet 2',
      userId: 'user456',
      username: 'testuser2',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getProfile.mockResolvedValue({ 
      profileImageUrl: 'http://example.com/avatar.png', 
      name: 'Test User 2' 
    });

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/avatar.png');
    expect(mockScraperInstance.getProfile).toHaveBeenCalledWith('testuser2');
  });
  
  test('Scenario 2.1: Profile Image URL Successfully Fetched by getProfile (avatar as fallback)', async () => {
    const tweet = {
      id: 'tweet2.1',
      text: 'Test tweet 2.1',
      userId: 'user4561',
      username: 'testuser21',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getProfile.mockResolvedValue({ 
      avatar: 'http://example.com/avatar_fallback.png', 
      name: 'Test User 2.1' 
    });

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/avatar_fallback.png');
    expect(mockScraperInstance.getProfile).toHaveBeenCalledWith('testuser21');
  });


  test('Scenario 3: getProfile Returns Profile Object Without Image URL', async () => {
    const tweet = {
      id: 'tweet3',
      text: 'Test tweet 3',
      userId: 'user789',
      username: 'testuser3',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getProfile.mockResolvedValue({ username: 'testuser3', name: 'Another User' });

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBeUndefined();
    expect(mockScraperInstance.getProfile).toHaveBeenCalledWith('testuser3');
  });

  test('Scenario 4: getProfile Returns null', async () => {
    const tweet = {
      id: 'tweet4',
      text: 'Test tweet 4',
      userId: 'user101',
      username: 'testuser4',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getProfile.mockResolvedValue(null);

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBeUndefined();
    expect(mockScraperInstance.getProfile).toHaveBeenCalledWith('testuser4');
  });
  
  test('Scenario 4.1: getProfile Returns undefined', async () => {
    const tweet = {
      id: 'tweet4.1',
      text: 'Test tweet 4.1',
      userId: 'user1011',
      username: 'testuser41',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getProfile.mockResolvedValue(undefined);

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBeUndefined();
    expect(mockScraperInstance.getProfile).toHaveBeenCalledWith('testuser41');
  });


  test('Scenario 5: getProfile Throws an Error', async () => {
    const tweet = {
      id: 'tweet5',
      text: 'Test tweet 5',
      userId: 'user202',
      username: 'testuser5',
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getProfile.mockRejectedValue(new Error('Failed to fetch profile'));

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBeUndefined();
    expect(mockScraperInstance.getProfile).toHaveBeenCalledWith('testuser5');
  });

  test('Scenario 6: Retweet - Profile Image of Original Poster (via getProfile)', async () => {
    const tweet = {
      id: 'rt1',
      isRetweet: true,
      userId: 'retweeterId', // Irrelevant for original author image
      username: 'retweeterName', // Irrelevant for original author image
      retweetedStatusId: 'originalTweet1',
      retweetedStatus: {
        id: 'originalTweet1',
        text: 'Original tweet content',
        userId: 'originalUserId',
        username: 'originalPosterUsername', // This username should be used for getProfile
        timestamp: Date.now() / 1000,
      },
      timestamp: Date.now() / 1000 + 100,
    };
    mockScraperInstance.getProfile.mockResolvedValue({ 
      profile_image_url_https: 'http://example.com/original_profile.jpg',
      name: 'Original Poster'
    });

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/original_profile.jpg');
    expect(result[0].metadata.authorUserName).toBe('originalPosterUsername');
    expect(mockScraperInstance.getProfile).toHaveBeenCalledWith('originalPosterUsername');
  });
  
  test('Scenario 6.1: Retweet - Fetches missing retweetedStatus, then uses getProfile for image', async () => {
    const rawTweet = {
        id: 'rt_fetch_getProfile',
        isRetweet: true,
        userId: 'retweeterRealNameId',
        username: 'retweeterRealName',
        retweetedStatusId: 'originalTweetFetchedForGetProfile', // ID to fetch
        timestamp: Date.now() / 1000 + 300,
    };
    const fetchedOriginalTweet = { 
        id: 'originalTweetFetchedForGetProfile',
        text: 'Fetched original tweet text',
        userId: 'originalUserFetchedId',
        username: 'originalUserFetchedUsername', // This username will be used
        timestamp: Date.now() / 1000,
    };

    mockScraperInstance.getTweet.mockResolvedValue(fetchedOriginalTweet);
    mockScraperInstance.getProfile.mockResolvedValue({ profile_image_url_https: 'http://example.com/fetched_original_via_getprofile.jpg' });

    const result = await callProcessTweets([rawTweet]);

    expect(mockScraperInstance.getTweet).toHaveBeenCalledWith('originalTweetFetchedForGetProfile');
    expect(mockScraperInstance.getProfile).toHaveBeenCalledWith('originalUserFetchedUsername');
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/fetched_original_via_getprofile.jpg');
    expect(result[0].metadata.authorUserName).toBe('originalUserFetchedUsername');
  });


  test('Scenario 7: Tweet without username (should not call getProfile)', async () => {
    const tweet = {
      id: 'tweet6',
      text: 'Test tweet 6',
      userId: 'user303',
      username: null, // Username is null
      timestamp: Date.now() / 1000,
    };

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBeUndefined();
    expect(result[0].metadata.authorUserName).toBeNull();
    expect(mockScraperInstance.getProfile).not.toHaveBeenCalled();
  });
  
  test('Scenario 7.1: Tweet with undefined username (should not call getProfile)', async () => {
    const tweet = {
      id: 'tweet6.1',
      text: 'Test tweet 6.1',
      userId: 'user3031',
      username: undefined, // Username is undefined
      timestamp: Date.now() / 1000,
    };

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBeUndefined();
    expect(result[0].metadata.authorUserName).toBeUndefined();
    expect(mockScraperInstance.getProfile).not.toHaveBeenCalled();
  });

  test('Scenario 8: Quoted Tweet - Profile Image of Main Tweet Poster (via getProfile)', async () => {
    const tweet = {
      id: 'qt1',
      text: 'Quoting another tweet',
      userId: 'quoterUserId',
      username: 'quoterUsername', // Main quoter's username
      isQuoted: true,
      quotedStatusId: 'qStatus1',
      quotedStatus: { 
        id: 'qStatus1', text: 'Quoted text', userId: 'quotedAuthorId', username: 'quotedAuthorUsername', 
        timestamp: Date.now()/1000 - 100
      },
      timestamp: Date.now() / 1000,
    };
    mockScraperInstance.getProfile.mockResolvedValue({ 
      profile_image_url_https: 'http://example.com/quoter_image.jpg',
      name: 'Quoter User'
    });

    const result = await callProcessTweets([tweet]);
    expect(result[0].metadata.authorProfileImageUrl).toBe('http://example.com/quoter_image.jpg');
    expect(result[0].metadata.authorUserName).toBe('quoterUsername');
    // Ensure getProfile was called for the main quoter, not the quoted author
    expect(mockScraperInstance.getProfile).toHaveBeenCalledWith('quoterUsername'); 
    expect(result[0].metadata.quotedTweet).toBeDefined();
    expect(result[0].metadata.quotedTweet.userName).toBe('quotedAuthorUsername');
  });

});

pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ReviewSystem is ZamaEthereumConfig {
    struct Review {
        euint32 encryptedScore;
        string encryptedComments;
        address reviewer;
        uint256 submissionDate;
        bool isVerified;
    }

    struct Paper {
        string title;
        string encryptedContent;
        address submitter;
        uint256 submissionDate;
        Review[] reviews;
        euint32 aggregatedScore;
        bool isPublished;
    }

    mapping(string => Paper) public papers;
    mapping(string => Review) public reviews;

    event PaperSubmitted(string indexed paperId, address indexed submitter);
    event ReviewSubmitted(string indexed paperId, address indexed reviewer);
    event ScoreAggregated(string indexed paperId, euint32 aggregatedScore);
    event PaperPublished(string indexed paperId);

    constructor() ZamaEthereumConfig() {}

    function submitPaper(
        string calldata paperId,
        string calldata title,
        externalEuint32 encryptedContent,
        bytes calldata contentProof
    ) external {
        require(bytes(papers[paperId].title).length == 0, "Paper already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedContent, contentProof)), "Invalid encrypted content");

        papers[paperId] = Paper({
        title: title,
        encryptedContent: FHE.fromExternal(encryptedContent, contentProof),
        submitter: msg.sender,
        submissionDate: block.timestamp,
        reviews: new Review[](0),
        aggregatedScore: FHE.zero(),
        isPublished: false
        });

        FHE.allowThis(papers[paperId].encryptedContent);
        FHE.makePubliclyDecryptable(papers[paperId].encryptedContent);

        emit PaperSubmitted(paperId, msg.sender);
    }

    function submitReview(
        string calldata paperId,
        externalEuint32 encryptedScore,
        bytes calldata scoreProof,
        string calldata encryptedComments
    ) external {
        require(bytes(papers[paperId].title).length > 0, "Paper does not exist");
        require(FHE.isInitialized(FHE.fromExternal(encryptedScore, scoreProof)), "Invalid encrypted score");

        Review memory review = Review({
        encryptedScore: FHE.fromExternal(encryptedScore, scoreProof),
        encryptedComments: encryptedComments,
        reviewer: msg.sender,
        submissionDate: block.timestamp,
        isVerified: false
        });

        papers[paperId].reviews.push(review);
        reviews[string(abi.encodePacked(paperId, "_", uint256(papers[paperId].reviews.length - 1))] = review;

        FHE.allowThis(review.encryptedScore);
        FHE.makePubliclyDecryptable(review.encryptedScore);

        emit ReviewSubmitted(paperId, msg.sender);
    }

    function aggregateScores(string calldata paperId) external {
        require(bytes(papers[paperId].title).length > 0, "Paper does not exist");
        require(papers[paperId].reviews.length > 0, "No reviews to aggregate");

        euint32 totalScore = FHE.zero();
        for (uint256 i = 0; i < papers[paperId].reviews.length; i++) {
            totalScore = FHE.add(totalScore, papers[paperId].reviews[i].encryptedScore);
        }

        papers[paperId].aggregatedScore = totalScore;
        emit ScoreAggregated(paperId, totalScore);
    }

    function publishPaper(string calldata paperId) external {
        require(bytes(papers[paperId].title).length > 0, "Paper does not exist");
        require(!FHE.isZero(papers[paperId].aggregatedScore), "Scores not aggregated");
        require(!papers[paperId].isPublished, "Paper already published");

        papers[paperId].isPublished = true;
        emit PaperPublished(paperId);
    }

    function getPaperDetails(string calldata paperId) external view returns (
        string memory title,
        address submitter,
        uint256 submissionDate,
        euint32 aggregatedScore,
        bool isPublished
    ) {
        require(bytes(papers[paperId].title).length > 0, "Paper does not exist");
        Paper storage paper = papers[paperId];
        return (paper.title, paper.submitter, paper.submissionDate, paper.aggregatedScore, paper.isPublished);
    }

    function getReviewDetails(string calldata paperId, uint256 reviewIndex) external view returns (
        euint32 encryptedScore,
        string memory encryptedComments,
        address reviewer,
        uint256 submissionDate,
        bool isVerified
    ) {
        require(bytes(papers[paperId].title).length > 0, "Paper does not exist");
        require(reviewIndex < papers[paperId].reviews.length, "Invalid review index");
        Review storage review = papers[paperId].reviews[reviewIndex];
        return (review.encryptedScore, review.encryptedComments, review.reviewer, review.submissionDate, review.isVerified);
    }

    function verifyReview(
        string calldata paperId,
        uint256 reviewIndex,
        bytes memory abiEncodedClearScore,
        bytes memory decryptionProof
    ) external {
        require(bytes(papers[paperId].title).length > 0, "Paper does not exist");
        require(reviewIndex < papers[paperId].reviews.length, "Invalid review index");
        require(!papers[paperId].reviews[reviewIndex].isVerified, "Review already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(papers[paperId].reviews[reviewIndex].encryptedScore);

        FHE.checkSignatures(cts, abiEncodedClearScore, decryptionProof);
        papers[paperId].reviews[reviewIndex].isVerified = true;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


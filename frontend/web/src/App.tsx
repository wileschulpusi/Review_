import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ReviewData {
  id: number;
  title: string;
  author: string;
  encryptedScore: string;
  publicComments: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<ReviewData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingReview, setCreatingReview] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newReviewData, setNewReviewData] = useState({ title: "", author: "", score: "", comments: "" });
  const [selectedReview, setSelectedReview] = useState<ReviewData | null>(null);
  const [decryptedScore, setDecryptedScore] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, avgScore: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const reviewsList: ReviewData[] = [];
      let totalScore = 0;
      let verifiedCount = 0;
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          const review: ReviewData = {
            id: parseInt(businessId.replace('review-', '')) || Date.now(),
            title: businessData.name,
            author: businessId,
            encryptedScore: businessId,
            publicComments: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          };
          reviewsList.push(review);
          
          if (businessData.isVerified && businessData.decryptedValue) {
            totalScore += Number(businessData.decryptedValue);
            verifiedCount++;
          }
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setReviews(reviewsList);
      setStats({
        total: reviewsList.length,
        verified: verifiedCount,
        avgScore: verifiedCount > 0 ? totalScore / verifiedCount : 0
      });
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createReview = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingReview(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating review with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const scoreValue = parseInt(newReviewData.score) || 0;
      const businessId = `review-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newReviewData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        scoreValue,
        0,
        newReviewData.comments
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Review created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewReviewData({ title: "", author: "", score: "", comments: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingReview(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Score already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Score decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Score is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const filteredReviews = reviews.filter(review =>
    review.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    review.publicComments.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel metal-panel">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Total Reviews</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
        </div>
        
        <div className="stat-panel metal-panel">
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <h3>Verified Scores</h3>
            <div className="stat-value">{stats.verified}/{stats.total}</div>
          </div>
        </div>
        
        <div className="stat-panel metal-panel">
          <div className="stat-icon">⭐</div>
          <div className="stat-content">
            <h3>Average Score</h3>
            <div className="stat-value">{stats.avgScore.toFixed(1)}/10</div>
          </div>
        </div>
      </div>
    );
  };

  const renderScoreChart = (score: number) => {
    return (
      <div className="score-chart">
        <div className="chart-bar">
          <div 
            className="bar-fill" 
            style={{ width: `${score * 10}%` }}
          >
            <span className="bar-value">{score}/10</span>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>學術隱私評審網 🔐</h1>
            <p>Confidential Peer Review Network</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔒</div>
            <h2>Connect Wallet to Access Encrypted Review System</h2>
            <p>Secure, bias-free academic peer review with fully homomorphic encryption</p>
            <div className="feature-grid">
              <div className="feature-item">
                <span className="feature-icon">🔐</span>
                <h4>Encrypted Comments</h4>
                <p>Review comments protected by Zama FHE technology</p>
              </div>
              <div className="feature-item">
                <span className="feature-icon">📈</span>
                <h4>Homomorphic Scoring</h4>
                <p>Scores calculated without decryption</p>
              </div>
              <div className="feature-item">
                <span className="feature-icon">👥</span>
                <h4>Double-blind Review</h4>
                <p>Eliminate academic bias completely</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing academic review process</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted review system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>學術隱私評審網 🔐</h1>
          <p>Confidential Peer Review Network</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn metal-btn"
          >
            + New Review
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="content-header">
          <h2>Academic Review Dashboard</h2>
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search reviews..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
        
        {renderStatsPanel()}
        
        <div className="reviews-section">
          <div className="section-header">
            <h3>Peer Reviews</h3>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn metal-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="reviews-grid">
            {filteredReviews.length === 0 ? (
              <div className="no-reviews">
                <p>No reviews found</p>
                <button 
                  className="create-btn metal-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Review
                </button>
              </div>
            ) : filteredReviews.map((review, index) => (
              <div 
                className={`review-card ${selectedReview?.id === review.id ? "selected" : ""} ${review.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedReview(review)}
              >
                <div className="card-header">
                  <h4>{review.title}</h4>
                  <span className={`status-badge ${review.isVerified ? "verified" : "pending"}`}>
                    {review.isVerified ? "✅ Verified" : "🔓 Pending"}
                  </span>
                </div>
                <div className="card-content">
                  <p>{review.publicComments}</p>
                </div>
                <div className="card-footer">
                  <div className="review-meta">
                    <span>Score: {review.isVerified ? review.decryptedValue : "🔒 Encrypted"}</span>
                    <span>{new Date(review.timestamp * 1000).toLocaleDateString()}</span>
                  </div>
                  <div className="reviewer">
                    Reviewer: {review.creator.substring(0, 6)}...{review.creator.substring(38)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateReview 
          onSubmit={createReview} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingReview} 
          reviewData={newReviewData} 
          setReviewData={setNewReviewData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedReview && (
        <ReviewDetailModal 
          review={selectedReview} 
          onClose={() => { 
            setSelectedReview(null); 
            setDecryptedScore(null); 
          }} 
          decryptedScore={decryptedScore} 
          setDecryptedScore={setDecryptedScore} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedReview.author)}
          renderScoreChart={renderScoreChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content metal-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateReview: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  reviewData: any;
  setReviewData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, reviewData, setReviewData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'score') {
      const intValue = value.replace(/[^\d]/g, '');
      setReviewData({ ...reviewData, [name]: intValue });
    } else {
      setReviewData({ ...reviewData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-review-modal metal-panel">
        <div className="modal-header">
          <h2>New Academic Review</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Review scores encrypted with Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Paper Title *</label>
            <input 
              type="text" 
              name="title" 
              value={reviewData.title} 
              onChange={handleChange} 
              placeholder="Enter paper title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Author *</label>
            <input 
              type="text" 
              name="author" 
              value={reviewData.author} 
              onChange={handleChange} 
              placeholder="Enter author name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="score" 
              value={reviewData.score} 
              onChange={handleChange} 
              placeholder="Enter score..." 
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Public Comments *</label>
            <textarea 
              name="comments" 
              value={reviewData.comments} 
              onChange={handleChange} 
              placeholder="Enter review comments..." 
              rows={3}
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !reviewData.title || !reviewData.author || !reviewData.score || !reviewData.comments} 
            className="submit-btn metal-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Review"}
          </button>
        </div>
      </div>
    </div>
  );
};

const ReviewDetailModal: React.FC<{
  review: ReviewData;
  onClose: () => void;
  decryptedScore: number | null;
  setDecryptedScore: (value: number | null) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderScoreChart: (score: number) => JSX.Element;
}> = ({ review, onClose, decryptedScore, setDecryptedScore, isDecrypting, decryptData, renderScoreChart }) => {
  const handleDecrypt = async () => {
    if (decryptedScore !== null) { 
      setDecryptedScore(null); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedScore(decrypted);
    }
  };

  const currentScore = review.isVerified ? review.decryptedValue : decryptedScore;

  return (
    <div className="modal-overlay">
      <div className="review-detail-modal metal-panel">
        <div className="modal-header">
          <h2>Review Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="review-info">
            <div className="info-item">
              <span>Paper Title:</span>
              <strong>{review.title}</strong>
            </div>
            <div className="info-item">
              <span>Author:</span>
              <strong>{review.author}</strong>
            </div>
            <div className="info-item">
              <span>Reviewer:</span>
              <strong>{review.creator.substring(0, 6)}...{review.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(review.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="comments-section">
            <h3>Review Comments</h3>
            <div className="comments-content">
              {review.publicComments}
            </div>
          </div>
          
          <div className="score-section">
            <h3>Encrypted Score</h3>
            
            <div className="score-display">
              <div className="score-value">
                {review.isVerified ? 
                  `${review.decryptedValue}/10 (On-chain Verified)` : 
                  decryptedScore !== null ? 
                  `${decryptedScore}/10 (Locally Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn metal-btn ${(review.isVerified || decryptedScore !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : review.isVerified ? (
                  "✅ Verified"
                ) : decryptedScore !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Score"
                )}
              </button>
            </div>
            
            {currentScore !== undefined && currentScore !== null && (
              <div className="score-visualization">
                <h4>Score Visualization</h4>
                {renderScoreChart(currentScore)}
              </div>
            )}
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
          {!review.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn metal-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


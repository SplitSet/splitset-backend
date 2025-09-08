const db = require('../db');
const { nanoid } = require('nanoid');

class Run {
  static tableName = 'runs';

  static async findById(id) {
    return await db(this.tableName).where({ id }).first();
  }

  static async findByRunId(runId) {
    return await db(this.tableName).where({ run_id: runId }).first();
  }

  static async create(data) {
    const { storeId, type, inputParams = {} } = data;
    const runId = nanoid();
    
    const [id] = await db(this.tableName).insert({
      run_id: runId,
      store_id: storeId,
      type,
      input_params: JSON.stringify(inputParams),
      status: 'pending'
    });

    return await this.findById(id);
  }

  static async updateStatus(runId, status, data = {}) {
    const updateData = { status };
    
    if (status === 'running') {
      updateData.started_at = new Date();
    }
    
    if (status === 'completed' || status === 'failed') {
      updateData.finished_at = new Date();
    }
    
    if (data.stats) {
      updateData.stats = JSON.stringify(data.stats);
    }
    
    if (data.error) {
      updateData.error_message = data.error;
    }

    await db(this.tableName).where({ run_id: runId }).update(updateData);
    return await this.findByRunId(runId);
  }

  static async findByStore(storeId, filters = {}) {
    let query = db(this.tableName).where({ store_id: storeId });
    
    if (filters.type) {
      query = query.where({ type: filters.type });
    }
    
    if (filters.status) {
      query = query.where({ status: filters.status });
    }
    
    return await query.orderBy('created_at', 'desc').limit(filters.limit || 50);
  }

  static async findRunningByType(storeId, type) {
    return await db(this.tableName)
      .where({ 
        store_id: storeId, 
        type, 
        status: 'running' 
      })
      .first();
  }

  static async cleanup(olderThanDays = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    
    return await db(this.tableName)
      .where('created_at', '<', cutoff)
      .whereIn('status', ['completed', 'failed', 'cancelled'])
      .del();
  }
}

module.exports = Run;

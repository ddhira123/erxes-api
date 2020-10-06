import { Customers, Conformities, Cars, CarCategories, Deals, Products, ProductCategories, Stages, Pipelines, Boards, Loyalties } from '../../../db/models';
import { sendEmail, regexSearchText } from '../../utils';
import { ICustomerDocument } from '../../../db/models/definitions/customers';
import { ICarDocument } from '../../../db/models/definitions/cars';

const sendError = message => ({
  status: 'error',
  errorMessage: message,
});

const sendSuccess = data => ({
  status: 'success',
  data,
});

/*
 * MobileBackend
 */
export const receiveMobileBackend = async msg => {
  const { action, data } = msg;
  let customer: ICustomerDocument | null = null;

  switch (action) {
    case 'createCustomer':
      customer = await Customers.getWidgetCustomer({
        email: data.email,
        phone: data.phoneNumber,
      });

      const doc = {
        email: data.email,
        phone: data.phoneNumber,
        deviceToken: data.deviceToken,
        firstName: data.firstName,
        lastName: data.lastName,
        description: data.address,
        integrationId: data.integrationId,
      };

      customer = customer
        ? await Customers.updateMessengerCustomer({ _id: customer._id, doc })
        : await Customers.createMessengerCustomer({ doc });

      return sendSuccess(customer);

    case 'sendEmail':
      return sendSuccess(await sendEmail({
        toEmails: [data.email],
        title: data.title,
        template: {
          name: data.title,
          data: {
            content: data.newPassword,
          },
        }
      }));

    case 'updateCar':
      return sendSuccess(await Cars.updateCar(data._id, {...data}));

    case 'removeCars':
      return sendSuccess(await Cars.removeCars(data.carIds))
  }
};

export const receiveRPCMobileBackend = async msg => {
  const { action, data } = msg;
  let customer: ICustomerDocument | null = null;
  let filter: any = {}
  let car: ICarDocument | null = null;
  let dealIdsOfCustomer: string[] = [];

  switch (action) {
    case 'getUserAdditionInfo':
      customer = await Customers.getWidgetCustomer({ email: data.user.email, phone: data.user.phoneNumber });

      if (!customer) {
        return sendError('User has not customer')
      }

      const loyalty = await Loyalties.getLoyaltyValue(customer)

      filter = {}
      dealIdsOfCustomer = await Conformities.savedConformity({mainType: 'customer', mainTypeId: customer._id, relTypes: ['deal']});

      if (data.carId) {
        const dealIdsOfCar = await Conformities.savedConformity({mainType: 'car', mainTypeId: data.carId, relTypes: ['deal']});
        filter._id = { $in: dealIdsOfCar }
      }

      const wStageIds = await Stages.find({probability: 'Won'}, { _id: 1 })
      filter.stageId = { $in: wStageIds }

      const dealCount = await Deals.find({ $and: [{_id: { $in: dealIdsOfCustomer }}, filter]}).countDocuments();

      return sendSuccess({ loyalty, dealCount });

    case 'createCar':
      try{
        car = await Cars.createCar({...data});
        customer = await Customers.getWidgetCustomer({ email: data.user.email, phone: data.user.phoneNumber });
        if (!customer) {
          customer = await Customers.createMessengerCustomer({doc: {
            email: data.user.email,
            phone: data.user.phoneNumber,
            deviceToken: data.deviceToken,
            integrationId: 'MobileBend'
          }});
        }
        await Conformities.addConformity({mainType: 'customer', mainTypeId: customer._id, relType: 'car', relTypeId: car._id});
      } catch (e) {
        return sendError(e.message)
      }

      return sendSuccess(car);

    case 'filterCars':
      customer = await Customers.getWidgetCustomer({ email: data.user.email, phone: data.user.phoneNumber });

      if (!customer) {
        return sendError('User has not customer')
      }
      const carIds = await Conformities.savedConformity({mainType: 'customer', mainTypeId: customer._id, relTypes: ['car'] })

      filter = {};

      if (data.ids) {
        filter._id = {$in: data.ids}
      }

      if (data.searchValue){
        filter.searchText = { $in: [new RegExp(`.*${data.searchValue}.*`, 'i')] }
      }

      if (data.categoryId) {
        filter.categoryId = data.categoryId
      }

      return sendSuccess(await Cars.aggregate([
        {$match: {$and: [{_id: { $in: carIds }}, filter]}},
        { $lookup: {
          from: 'car_categories',
          localField: 'categoryId',
          foreignField: '_id',
          as: 'category'
        }},
        { $unwind: '$category' }
      ]));

    case 'getCar':
      car = await Cars.findOne({ _id: data._id });

      if (!car) {
        return sendError('Car not found')
      }

      return sendSuccess({car, category: await CarCategories.findOne({ _id: car.categoryId })});

    case 'filterCarCategories':
      filter = {}
      filter.parentId = data.parentId || '';

      if (data.searchValue) {
        filter.name = new RegExp(`.*${data.searchValue}.*`, 'i');
      }

      return sendSuccess(await CarCategories.aggregate( [
        { $match: filter },
        { $lookup: {
          from: 'car_categories',
          localField: '_id',
          foreignField: 'parentId',
          as: 'childs'
        } },
        { $project: { code: 1, name: 1, description: 1, parentId: 1, order: 1, childCount: {$size: '$childs'} } },
        { $sort: { order: 1 } }
      ] ))

    case 'getProduct':
      const product = await Products.findOne({_id: data.productId });

      if (!product) {
        return sendError('Product not found')
      }

      return sendSuccess({product, category: await ProductCategories.findOne({ _id: product.categoryId })});

    case 'filterProductCategories':
      filter = {}
      filter.parentId = data.parentId;

      if (data.searchValue) {
        filter.name = new RegExp(`.*${data.searchValue}.*`, 'i');
      }

      return sendSuccess(await ProductCategories.aggregate(
        [
          { $match: filter },
          { $lookup: {
            from: 'product_categories',
            localField: '_id',
            foreignField: 'parentId',
            as: 'childs'
          } },
          { $project: { code: 1, name: 1, description: 1, parentId: 1, order: 1, childCount: {$size: '$childs'} } },
          { $sort: { order: 1 } }
        ]
      ));

    case 'filterProducts':
      if (data.ids) {
        filter._id = { $in: data.ids }
      }

      if (data.type) {
        filter.type = data.type;
      }

      if (data.searchValue) {
        const fields = [
          { name: { $in: [new RegExp(`.*${data.searchValue}.*`, 'i')] } },
          { code: { $in: [new RegExp(`.*${data.searchValue}.*`, 'i')] } },
        ];

        filter.$or = fields;
      }

      if (data.categoryId) {
        filter.categoryId = data.categoryId
      }

      return sendSuccess(await Products.aggregate([
        {$match: filter},
        { $lookup: {
          from: 'product_categories',
          localField: 'categoryId',
          foreignField: '_id',
          as: 'category'
        }},
        { $unwind: '$category' }
      ]))

    case 'filterDeals':
      customer = await Customers.getWidgetCustomer({ email: data.user.email, phone: data.user.phoneNumber });

      if (!customer) {
        return sendError('User has not customer')
      }

      filter = {}
      dealIdsOfCustomer = await Conformities.savedConformity({mainType: 'customer', mainTypeId: customer._id, relTypes: ['deal']});

      if (data.carId) {
        const dealIdsOfCar = await Conformities.savedConformity({mainType: 'car', mainTypeId: data.carId, relTypes: ['deal']});
        filter._id = { $in: dealIdsOfCar }
      }

      if (data.search){
        Object.assign(filter, regexSearchText(data.search));
      }

      const stageFilter = data.kind === 'Won' ? { probability: 'Won' } : { probability: { $ne: 'Won' } }
      const wonStageIds = await Stages.find(stageFilter, { _id: 1 })
      filter.stageId = { $in: wonStageIds }

      const deals = await Deals.find({ $and: [{_id: { $in: dealIdsOfCustomer }}, filter]});

      const stageIds = deals.map(deal => deal.stageId);
      const stages = await Stages.find({_id: {$in: stageIds}}, {_id: 1, name: 1, pipelineId: 1});
      const pipelineIds = stages.map(stage => stage.pipelineId);
      const pipelines = await Pipelines.find({_id: {$in: pipelineIds}}, {_id: 1, name: 1, boardId: 1});
      const boardIds = pipelines.map(pipeline => pipeline.boardId);
      const boards = await Boards.find({ _id: { $in: boardIds} }, {_id: 1, name: 1});

      const copyDeals: any[] = [...deals];
      const extDeals: any[] = [];

      for (const deal of copyDeals) {
        const stage = stages.find(stage => stage._id === deal.stageId);
        const pipeline = pipelines.find(pipeline => pipeline._id === stage?.pipelineId);

        extDeals.push({
          ...deal._doc,
          stage: stage?.name,
          pipeline: pipeline?.name,
          board: boards.find(board => board._id === pipeline?.boardId)?.name
        });
      }

      return sendSuccess(extDeals);

    case 'getDeal':
      return sendSuccess( await Deals.findOne({ _id: data._id }));

    case 'createDeal':
      customer = await Customers.getWidgetCustomer({ email: data.user.email, phone: data.user.phoneNumber });

      if (!customer) {
        return sendError('User has not customer')
      }

      const deal = await Deals.createDeal({ ...data.dealDoc });

      await Conformities.addConformity({ mainType: 'deal', mainTypeId: deal._id, relType: 'customer', relTypeId: customer._id})

      if (data.carId){
        await Conformities.addConformity({ mainType: 'deal', mainTypeId: deal._id, relType: 'car', relTypeId: data.carId})
      }

      return sendSuccess(deal);
  }
}